import { requestBookPreviewFonts } from "./project-book-preview-fonts.js";
import { beginBookSettingsSync, leaveBookSettingsPage1, acceptRemoteBookSettings } from "./project-book-settings-sync.js";
import { portableBookOptions } from "./project-book-settings-document.js";
import { extractInlineMarkupVisibleText } from "./editor-inline-markup/serialize.js";
import { extractVellumLeadingHeadingTitle } from "./vellum-text-editor-content.js";
import { cancelBookTitlePreview, requestBookTitlePreview } from "./project-book-title-preview.js";
import { bookEditorText } from "./project-book-text.js";
import { state } from "./state.js";
import { invoke, convertLocalFileSrc } from "./runtime.js";
import { findChapterContext, selectedProjectsTeam } from "./project-context.js";
import { projectRepoScope, waitForRepoWriteQueueIdle } from "./repo-write-queue.js";
import { buildEditorPreviewDocument } from "./editor-preview.js";
import { normalizeEditorRows } from "./editor-state-flow.js";
import { openLocalFilePicker } from "./local-file-picker.js";
import { enforceImportFileSizeLimit } from "./import-file-limit.js";
import { formatErrorForDisplay } from "./error-display.js";
import { addBookSection, bookChapterDefaultTitle, bookItemIncluded, bookSectionLabel, bookContentsItems, bookLanguages, includeBookItem, reconcileBookLayout, reorderBookItems } from "./project-book-model.js";
import { loadBookSettings, loadContentsTitle, saveBookSettings, saveContentsTitle } from "./project-book-settings.js";

const modal = () => state.editorChapter?.exportModal;
const project = () => state.projects.find((entry) => entry.id === modal()?.projectId);
export const BOOK_IMAGE_ACCEPT = ".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml";
export const bookImageSrc = (image) => image?.filePath ? convertLocalFileSrc(image.filePath) : image?.dataUrl || "";

function update(patch, render) {
  const current = modal();
  if (!current?.projectId) return;
  const next = { ...current, ...patch };
  if (next.book && (next.book.items !== current.book?.items || next.languageCode !== current.languageCode)) {
    const ids = next.book.items.filter((item) => item.kind === "chapter" && bookItemIncluded(item)).map((item) => item.chapterId);
    if (JSON.stringify(ids) !== JSON.stringify(current.chapterIds)) next.chapterIds = ids;
  }
  state.editorChapter = { ...state.editorChapter, exportModal: next };
  saveBookSettings(next);
  if (render) {
    // Background title/preview loads must not interrupt a title being typed.
    const focused = typeof document === "undefined" ? null : document.activeElement;
    const titleId = focused?.dataset?.bookChapterTitle;
    const selection = titleId ? [focused.selectionStart, focused.selectionEnd] : null;
    render();
    if (titleId) {
      const input = document.querySelector(`[data-book-chapter-title="${CSS.escape(titleId)}"]`);
      input?.focus({ preventScroll: true });
      if (input && selection) input.setSelectionRange(...selection);
    }
    requestBookPreviewFonts(render);
  }
}

const previewState = () => ({ previewStatus: "idle", previewBlocks: [], previewChapterId: "", previewCache: new Map(), addMenuOpen: false });

export function initializeProjectBook(projectRecord, chapters, defaultLanguageCode) {
  const saved = loadBookSettings(projectRecord.id);
  const languages = bookLanguages(chapters);
  const languageCode = languages.some((entry) => entry.code === saved.languageCode) ? saved.languageCode : defaultLanguageCode || languages[0]?.code || "";
  const book = { ...reconcileBookLayout(chapters, languageCode, saved.layouts?.[languageCode]), ...previewState(), settingsLocalSeeded: Boolean(saved.layouts?.[languageCode]) };
  return { languageCode, languages, book, page: 1, savedOptions: { ...saved.options, ...portableBookOptions(saved.layouts?.[languageCode]?.options) } };
}

export function selectProjectBookLanguage(render, code) {
  const current = modal();
  if (!current?.book || current.status !== "idle" || !current.languages.some((language) => language.code === code)) return;
  saveBookSettings(current);
  const saved = loadBookSettings(current.projectId);
  const book = { ...reconcileBookLayout(project()?.chapters ?? [], code, saved.layouts?.[code]), ...previewState(), settingsEntryId: current.book.settingsEntryId, settingsLocalSeeded: true };
  const options = portableBookOptions(saved.layouts?.[code]?.options);
  update({ ...options, languageCode: code, book, pdfFontStatus: "idle", pdfFontInspectionKey: "", error: "" }, render);
  void loadSelectedBookPreview(render);
}

export function applyProjectBookSettings(saved, render, page = modal()?.page) {
  const current = modal();
  if (!current?.book || !current.isOpen) return;
  const code = current.languageCode;
  const options = portableBookOptions(saved.layouts?.[code]?.options || saved.options);
  const book = { ...reconcileBookLayout(project()?.chapters || [], code, saved.layouts?.[code]), ...previewState(), settingsEntryId: current.book.settingsEntryId, settingsLocalSeeded: true };
  update({ ...options, page, languageCode: code, book, pdfFontStatus: "idle", pdfFontInspectionKey: "", error: "" }, render);
  if (page === 1) void loadSelectedBookPreview(render);
  else if (modal().selectedOptionId === "file:pdf") void import("./editor-export-flow.js").then((module) => module.refreshPdfFontInspection(render));
}

export async function loadSelectedBookPreview(render, operations = {}) {
  const current = modal();
  const item = current?.book?.items.find((entry) => entry.id === current.book.selectedItemId);
  if (!current?.isOpen || !current.book) return;
  requestBookTitlePreview(render);
  requestBookPreviewFonts(render);
  const repaint = () => render?.({ scope: "project-book-preview" });
  if (item?.kind === "contents" && item.includeH1Headings) return loadContentsHeadings(repaint, current, operations);
  const team = selectedProjectsTeam();
  const cache = current.book.previewCache;
  const isCurrent = () => modal()?.isOpen && modal()?.book?.previewCache === cache && state.selectedTeamId === team?.id;
  const load = (chapter) => {
    if (!cache.has(chapter.id)) cache.set(chapter.id, (async () => {
      const context = findChapterContext(chapter.chapterId);
      try {
        await (operations.waitForRepoQueue ?? waitForRepoWriteQueueIdle)(projectRepoScope({ team, project: context?.project }));
        const payload = await (operations.invoke ?? invoke)("load_gtms_chapter_editor_data", { input: {
          installationId: team.installationId, projectId: current.projectId, repoName: context.project.name, chapterId: chapter.chapterId,
        } });
        const blocks = buildEditorPreviewDocument(normalizeEditorRows(payload?.rows), current.languageCode);
        if (isCurrent()) {
          const book = modal().book;
          update({ book: { ...book,
            items: book.items.map((entry) => entry.id === chapter.id ? { ...entry, defaultTitle: bookChapterDefaultTitle(blocks, entry.name) } : entry),
            ...(book.selectedItemId === chapter.id ? { previewStatus: "ready", previewChapterId: chapter.chapterId, previewBlocks: blocks } : {}),
          } }, repaint);
        }
        return { blocks };
      } catch (error) {
        return { error: formatErrorForDisplay(error) };
      }
    })());
    return cache.get(chapter.id);
  };
  // Resolve all list titles once per language/session, sharing chapter reads with
  // the preview and limiting background reads for large projects.
  if (!cache.started) {
    cache.started = true;
    const pending = current.book.items.filter((entry) => entry.kind === "chapter" && entry.available !== false && entry.id !== item?.id);
    for (let worker = 0; worker < 3; worker++) void (async () => {
      while (pending.length && isCurrent()) await load(pending.shift());
    })();
  }
  if (item?.kind !== "chapter") return;
  update({ book: { ...modal().book, previewStatus: item.available === false ? "ready" : "loading", previewBlocks: [], previewChapterId: item.chapterId } }, repaint);
  if (item.available === false) return;
  const result = await load(item);
  if (!isCurrent() || modal().book.selectedItemId !== item.id) return;
  update({ book: { ...modal().book, previewStatus: result.error ? "error" : "ready", previewError: result.error || "", previewBlocks: result.blocks || [], previewChapterId: item.chapterId } }, repaint);
}

let previewGeneration = 0;

async function loadContentsHeadings(render, current, operations) {
  const team = selectedProjectsTeam();
  const record = project();
  const request = `contents:${++previewGeneration}:${current.projectId}:${current.languageCode}`;
  const isCurrent = () => modal()?.isOpen && modal()?.book?.previewRequest === request;
  update({ book: { ...current.book, previewRequest: request } });
  try {
    await (operations.waitForRepoQueue ?? waitForRepoWriteQueueIdle)(projectRepoScope({ team, project: record }));
    const headings = {};
    const defaultTitles = new Map();
    for (const item of bookContentsItems(current.book.items)) {
      const payload = await (operations.invoke ?? invoke)("load_gtms_chapter_editor_data", { input: {
        installationId: team.installationId, projectId: current.projectId, repoName: record.name, chapterId: item.chapterId,
      } });
      if (!isCurrent()) return;
      const blocks = buildEditorPreviewDocument(normalizeEditorRows(payload?.rows), current.languageCode);
      defaultTitles.set(item.id, bookChapterDefaultTitle(blocks, item.name));
      const body = extractVellumLeadingHeadingTitle(blocks) ? blocks.slice(1) : blocks;
      headings[item.chapterId] = body.filter((block) => block.kind === "text" && block.textStyle === "heading1")
        .map((block) => extractInlineMarkupVisibleText(block.text));
    }
    if (isCurrent()) update({ book: { ...modal().book, contentsHeadings: headings,
      items: modal().book.items.map((entry) => defaultTitles.has(entry.id) ? { ...entry, defaultTitle: defaultTitles.get(entry.id) } : entry),
    }, error: "" }, render);
  } catch (error) {
    if (isCurrent()) update({ error: formatErrorForDisplay(error) }, render);
  }
}

export function updateBookField(element, render) {
  const current = modal();
  const item = current?.book?.items.find((entry) => entry.id === (element.dataset.bookChapterTitle || current.book.selectedItemId));
  const field = element.dataset.bookField;
  if (!item || !["title", "subtitle", "author", "translator", "text", "caption", "includeH1Headings"].includes(field)) return;
  const edited = element.hasAttribute("contenteditable") ? bookEditorText(element) : element.value;
  const value = field === "includeH1Headings" ? element.checked : field === "text" ? edited : edited.replaceAll("\u2028", "\n");
  if (element.hasAttribute("contenteditable")) element.dataset.bookEmpty = String(!value);
  if (element.dataset.bookChapterTitle) {
    const measure = element.parentElement?.querySelector("[data-book-title-size]");
    if (measure) measure.textContent = value || item.defaultTitle || item.name;
  }
  const items = current.book.items.map((entry) => entry.id === item.id ? { ...entry, [field]: value } : entry);
  update({ book: { ...current.book, items, ...(field === "includeH1Headings" ? { previewRequest: "" } : {}) }, pdfFontStatus: "idle", pdfFontInspectionKey: "" }, field === "includeH1Headings" || item.kind === "chapter" ? render : undefined);
  requestBookPreviewFonts(render);
  if (item.kind === "title") requestBookTitlePreview(render);
  if (field === "includeH1Headings" && value) void loadSelectedBookPreview(render);
  if (item.kind === "contents" && field === "title") saveContentsTitle(current.languageCode, value);
  if (field === "title" && item.kind !== "chapter") document.querySelector(`[data-book-item-label="${CSS.escape(item.id)}"]`)?.replaceChildren(document.createTextNode(item.kind === "title" ? bookSectionLabel("title") : value || bookSectionLabel(item.kind)));
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
      image.vellumAssetId = prepared.assetId;
      delete image.dataUrl;
    }
    if (modal()?.projectId !== current.projectId || modal()?.languageCode !== current.languageCode) return;
    update({ book: { ...modal().book, items: modal().book.items.map((entry) => entry.id === id ? { ...entry, image } : entry) }, error: "", pdfFontStatus: "idle" }, render);
    requestBookTitlePreview(render);
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
  if (action === "book-settings-ok") { acceptRemoteBookSettings(render); return true; }
  if (action === "book-next") { if (book.items.some(bookItemIncluded)) {
    leaveBookSettingsPage1(render);
    update({ page: 2 }, render);
    if (current.selectedOptionId === "file:pdf") void import("./editor-export-flow.js").then((module) => module.refreshPdfFontInspection(render));
  } }
  else if (action === "book-previous") {
    applyProjectBookSettings(loadBookSettings(current.projectId), render, 1);
    beginBookSettingsSync(render);
  }
  else if (action === "book-fonts-retry") requestBookPreviewFonts(render, { force: true });
  else if (action === "book-title-preview-retry") cancelBookTitlePreview();
  else if (action === "book-add-menu") update({ book: { ...book, addMenuOpen: !book.addMenuOpen } }, render);
  else if (action.startsWith("book-add:")) {
    const items = addBookSection(book.items, action.slice(9), current.projectTitle, loadContentsTitle(current.languageCode));
    const added = items.find((item) => !book.items.some((old) => old.id === item.id));
    update({ book: { ...book, items, selectedItemId: added?.id || book.selectedItemId, addMenuOpen: false }, pdfFontStatus: "idle" }, render);
  } else if (action.startsWith("book-select:")) {
    if (book.selectedItemId !== action.slice(12)) {
      const selected = book.items.find((item) => item.id === action.slice(12));
      update({ book: { ...book, selectedItemId: action.slice(12) } }, selected?.kind === "chapter"
        ? () => render?.({ scope: "project-book-preview" }) : render);
      void loadSelectedBookPreview(render);
    }
  } else if (action.startsWith("book-numbered:")) {
    const id = action.slice(14);
    update({ book: { ...book, items: book.items.map((item) => item.id === id && item.kind === "chapter" ? { ...item, numbered: item.numbered === false } : item) }, pdfFontStatus: "idle", pdfFontInspectionKey: "" }, () => render?.({ scope: "project-book-preview" }));
  } else if (action.startsWith("book-exclude:") || action.startsWith("book-include:")) {
    const include = action.startsWith("book-include:");
    const id = action.slice(13);
    update({ book: { ...book, items: includeBookItem(book.items, id, include) }, pdfFontStatus: "idle", pdfFontInspectionKey: "" });
    render?.({ scope: "project-book-preview" });
    if (book.items.find((item) => item.id === book.selectedItemId)?.kind === "contents") void loadSelectedBookPreview(render);
  } else if (action === "book-image-pick") await importBookImage(render, await openLocalFilePicker({ accept: BOOK_IMAGE_ACCEPT }));
  else if (action === "book-image-remove") update({ book: { ...book, items: book.items.map((item) => item.id === book.selectedItemId ? { ...item, image: null } : item) }, pdfFontStatus: "idle" }, render);
  else if (action.startsWith("book-copyright:")) {
    const editor = document.querySelector("[data-book-copyright-editor]");
    if (editor) {
      editor.focus();
      const command = action.slice(15);
      if (command === "italic") document.execCommand("italic");
      else document.execCommand("insertHTML", false, command === "symbol" ? "©" : "<hr><p><br></p>");
      updateBookField(editor);
    }
  }
  requestBookTitlePreview(render);
  return true;
}
