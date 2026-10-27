import { state } from "./state.js";
import { invoke, convertLocalFileSrc } from "./runtime.js";
import { findChapterContext, selectedProjectsTeam } from "./project-context.js";
import { projectRepoScope, waitForRepoWriteQueueIdle } from "./repo-write-queue.js";
import { buildEditorPreviewDocument } from "./editor-preview.js";
import { normalizeEditorRows } from "./editor-state-flow.js";
import { openLocalFilePicker } from "./local-file-picker.js";
import { enforceImportFileSizeLimit } from "./import-file-limit.js";
import { formatErrorForDisplay } from "./error-display.js";
import { addBookSection, bookItemIncluded, bookLanguages, includeBookItem, reconcileBookLayout, reorderBookItems } from "./project-book-model.js";
import { loadBookSettings, loadContentsTitle, saveBookSettings, saveContentsTitle } from "./project-book-settings.js";

const modal = () => state.editorChapter?.exportModal;
const project = () => state.projects.find((entry) => entry.id === modal()?.projectId);
export const BOOK_IMAGE_ACCEPT = ".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml";
export const bookImageSrc = (image) => image?.filePath ? convertLocalFileSrc(image.filePath) : image?.dataUrl || "";

function update(patch, render) {
  const current = modal();
  if (!current?.projectId) return;
  const next = { ...current, ...patch };
  if (next.book && (next.book.items !== current.book?.items || next.languageCode !== current.languageCode)) next.chapterIds = next.book.items.filter((item) => item.kind === "chapter" && bookItemIncluded(item)).map((item) => item.chapterId);
  state.editorChapter = { ...state.editorChapter, exportModal: next };
  saveBookSettings(next);
  render?.();
}

export function initializeProjectBook(projectRecord, chapters, defaultLanguageCode) {
  const saved = loadBookSettings(projectRecord.id);
  const languages = bookLanguages(chapters);
  const languageCode = languages.some((entry) => entry.code === saved.languageCode) ? saved.languageCode : defaultLanguageCode || languages[0]?.code || "";
  const book = { ...reconcileBookLayout(chapters, languageCode, saved.layouts?.[languageCode]), previewStatus: "idle", previewBlocks: [], previewChapterId: "", addMenuOpen: false };
  return { languageCode, languages, book, page: 1, savedOptions: saved.options ?? {} };
}

export function selectProjectBookLanguage(render, code) {
  const current = modal();
  if (!current?.book || current.status !== "idle" || !current.languages.some((language) => language.code === code)) return;
  saveBookSettings(current);
  const saved = loadBookSettings(current.projectId);
  const book = { ...reconcileBookLayout(project()?.chapters ?? [], code, saved.layouts?.[code]), previewStatus: "idle", previewBlocks: [], previewChapterId: "", addMenuOpen: false };
  update({ languageCode: code, book, pdfFontStatus: "idle", pdfFontInspectionKey: "", error: "" }, render);
  void loadSelectedBookPreview(render);
}

let previewGeneration = 0;

export async function loadSelectedBookPreview(render, operations = {}) {
  const current = modal();
  const item = current?.book?.items.find((entry) => entry.id === current.book.selectedItemId);
  if (!current?.isOpen || item?.kind !== "chapter") return;
  if (item.available === false) {
    update({ book: { ...current.book, previewStatus: "ready", previewBlocks: [], previewChapterId: item.chapterId } }, render);
    return;
  }
  const team = selectedProjectsTeam();
  const context = findChapterContext(item.chapterId);
  const request = `${++previewGeneration}:${current.projectId}:${current.languageCode}:${item.id}`;
  const isCurrent = () => modal()?.isOpen && modal()?.book?.previewRequest === request;
  update({ book: { ...current.book, previewStatus: "loading", previewRequest: request, previewBlocks: [], previewChapterId: item.chapterId } }, render);
  try {
    await (operations.waitForRepoQueue ?? waitForRepoWriteQueueIdle)(projectRepoScope({ team, project: context?.project }));
    const payload = await (operations.invoke ?? invoke)("load_gtms_chapter_editor_data", { input: {
      installationId: team.installationId, projectId: current.projectId, repoName: context.project.name, chapterId: item.chapterId,
    } });
    if (!isCurrent()) return;
    update({ book: { ...modal().book, previewStatus: "ready", previewBlocks: buildEditorPreviewDocument(normalizeEditorRows(payload?.rows), current.languageCode) } }, render);
  } catch (error) {
    if (isCurrent()) update({ book: { ...modal().book, previewStatus: "error", previewError: formatErrorForDisplay(error) } }, render);
  }
}

export function updateBookField(element) {
  const current = modal();
  const item = current?.book?.items.find((entry) => entry.id === current.book.selectedItemId);
  const field = element.dataset.bookField;
  if (!item || !["title", "subtitle", "author", "translator", "text", "caption"].includes(field)) return;
  const value = element.hasAttribute("contenteditable") ? copyrightEditorText(element) : element.value;
  const items = current.book.items.map((entry) => entry.id === item.id ? { ...entry, [field]: value } : entry);
  update({ book: { ...current.book, items }, pdfFontStatus: "idle", pdfFontInspectionKey: "" });
  if (item.kind === "contents" && field === "title") saveContentsTitle(current.languageCode, value);
  if (field === "title") document.querySelector(`[data-book-item-label="${CSS.escape(item.id)}"]`)?.replaceChildren(document.createTextNode(value || (item.kind === "contents" ? "Table of contents" : "Title page")));
}

function copyrightEditorText(element) {
  const walk = (node) => {
    if (node.nodeType === 3) return node.textContent;
    if (node.nodeType !== 1) return "";
    if (node.tagName === "HR") return "<hr>";
    if (node.tagName === "BR") return "\n";
    const body = [...node.childNodes].map(walk).join("");
    if (["I", "EM"].includes(node.tagName)) return `<i>${body}</i>`;
    return ["DIV", "P"].includes(node.tagName) ? `${body}\n` : body;
  };
  return [...element.childNodes].map(walk).join("").replace(/\n$/, "");
}

export async function importBookImage(render, file, operations = {}) {
  const current = modal();
  const id = current?.book?.selectedItemId;
  const item = current?.book?.items.find((entry) => entry.id === id);
  if (!file || !["title", "image"].includes(item?.kind)) return;
  try {
    let input;
    if (typeof file === "string") input = { sourcePath: file };
    else {
      enforceImportFileSizeLimit(file.size, file.name);
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      input = { fileName: file.name, dataBase64: btoa(binary) };
    }
    const image = await (operations.invoke ?? invoke)("import_project_book_image", { input });
    if (image.dataUrl?.startsWith("data:image/svg+xml")) {
      const raster = new Image();
      raster.src = image.dataUrl;
      await raster.decode();
      const scale = Math.min(1, 3200 / Math.max(raster.naturalWidth, raster.naturalHeight, 1));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(raster.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(raster.naturalHeight * scale));
      canvas.getContext("2d").drawImage(raster, 0, 0, canvas.width, canvas.height);
      const prepared = await (operations.invoke ?? invoke)("import_project_book_image", { input: {
        fileName: "book-image.png", dataBase64: canvas.toDataURL("image/png").split(",")[1],
      } });
      image.vellumFilePath = prepared.filePath;
      delete image.dataUrl;
    }
    if (modal()?.projectId !== current.projectId || modal()?.languageCode !== current.languageCode) return;
    update({ book: { ...modal().book, items: modal().book.items.map((entry) => entry.id === id ? { ...entry, image } : entry) }, error: "", pdfFontStatus: "idle" }, render);
  } catch (error) {
    if (modal()?.projectId === current.projectId && modal()?.languageCode === current.languageCode) update({ error: formatErrorForDisplay(error) }, render);
  }
}

export function moveProjectBookItem(render, id, targetId, after) {
  const current = modal();
  if (!current?.book || current.status !== "idle") return;
  update({ book: { ...current.book, items: reorderBookItems(current.book.items, id, targetId, after) }, pdfFontStatus: "idle", pdfFontInspectionKey: "" }, render);
}

export async function handleProjectBookAction(action, render) {
  if (!action.startsWith("book-")) return false;
  const current = modal();
  if (!current?.book || current.status !== "idle") return true;
  const book = current.book;
  if (action === "book-next") { if (book.items.some(bookItemIncluded)) {
    update({ page: 2 }, render);
    if (current.selectedOptionId === "file:pdf") void import("./editor-export-flow.js").then((module) => module.refreshPdfFontInspection(render));
  } }
  else if (action === "book-previous") update({ page: 1 }, render);
  else if (action === "book-add-menu") update({ book: { ...book, addMenuOpen: !book.addMenuOpen } }, render);
  else if (action.startsWith("book-add:")) {
    const items = addBookSection(book.items, action.slice(9), current.projectTitle, loadContentsTitle(current.languageCode));
    const added = items.find((item) => !book.items.some((old) => old.id === item.id));
    update({ book: { ...book, items, selectedItemId: added?.id || book.selectedItemId, addMenuOpen: false }, pdfFontStatus: "idle" }, render);
  } else if (action.startsWith("book-select:")) {
    update({ book: { ...book, selectedItemId: action.slice(12), previewRequest: "" } }, render);
    void loadSelectedBookPreview(render);
  } else if (action.startsWith("book-exclude:") || action.startsWith("book-include:")) {
    const include = action.startsWith("book-include:");
    const id = action.slice(13);
    update({ book: { ...book, items: includeBookItem(book.items, id, include) }, pdfFontStatus: "idle", pdfFontInspectionKey: "" }, render);
  } else if (action === "book-image-pick") await importBookImage(render, await openLocalFilePicker({ accept: BOOK_IMAGE_ACCEPT }));
  else if (action === "book-image-remove") update({ book: { ...book, items: book.items.map((item) => item.id === book.selectedItemId ? { ...item, image: null } : item) }, pdfFontStatus: "idle" }, render);
  else if (action.startsWith("book-copyright:")) {
    const editor = document.querySelector("[data-book-copyright-editor]");
    if (editor) {
      editor.focus();
      const command = action.slice(15);
      if (command === "italic") document.execCommand("italic");
      else document.execCommand("insertHTML", false, command === "symbol" ? "©" : "<hr><br>");
      updateBookField(editor);
    }
  }
  return true;
}
