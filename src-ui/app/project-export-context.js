import { bookTextParts } from "./project-book-text.js";
import { extractVellumLeadingHeadingTitle } from "./vellum-text-editor-content.js";
import { bookExportItems, bookContentsEntries, bookChapterNumbers, bookChapterDefaultTitle, bookChapterPreviewBlocks } from "./project-book-model.js";
import { state } from "./state.js";
import { invoke } from "./runtime.js";
import { compareFilesByName } from "./projects-list-model.js";
import { selectedProjectsTeam } from "./project-context.js";
import { buildEditorPreviewDocument } from "./editor-preview.js";
import { extractInlineMarkupVisibleText } from "./editor-inline-markup.js";
import { normalizeEditorRows } from "./editor-state-flow.js";
import { projectRepoScope, waitForRepoWriteQueueIdle } from "./repo-write-queue.js";

export function projectExportChapters(project) {
  return (Array.isArray(project?.chapters) ? project.chapters : [])
    .filter((chapter) => chapter?.id && chapter.status !== "deleted")
    .sort(compareFilesByName);
}

export function exportDefaultKey(modal = state.editorChapter?.exportModal) {
  return modal?.projectId ? `project:${modal.projectId}` : modal?.chapterId;
}

export function projectExportScopeInput(modal) {
  return modal?.projectId ? {
    chapterIds: modal.chapterIds,
    projectTitle: modal.projectTitle,
    ...(modal.book ? { bookItems: bookExportItems(modal) } : {}),
  } : {};
}

// Read a durable project snapshot without opening chapters or disturbing the
// editor session. The modal captures the displayed chapter order when opened.
export async function loadProjectExportBlocks(modal, operations = {}, { numberChapters = true } = {}) {
  const team = selectedProjectsTeam();
  const project = state.projects.find((entry) => entry.id === modal.projectId);
  if (!project || !Number.isFinite(team?.installationId) || (!modal.chapterIds?.length && !modal.book)) {
    throw new Error("Could not find the project files to export.");
  }
  await (operations.waitForRepoQueue ?? waitForRepoWriteQueueIdle)(projectRepoScope({ team, project }));
  const blocks = [];
  const chapterDocuments = new Map();
  const headings = {};
  const items = modal.book ? bookExportItems(modal) : modal.chapterIds.map((chapterId) => ({ kind: "chapter", chapterId, id: chapterId }));
  const numbers = bookChapterNumbers(items);
  for (const item of items) {
    if (item.kind !== "chapter") {
      continue;
    }
    const chapterId = item.chapterId;
    const payload = await (operations.invoke ?? invoke)("load_gtms_chapter_editor_data", {
      input: { installationId: team.installationId, projectId: project.id, repoName: project.name, chapterId },
    });
    const current = state.editorChapter?.exportModal;
    if (state.selectedTeamId !== team.id || !current?.isOpen
      || current.projectId !== modal.projectId || current.chapterIds !== modal.chapterIds) {
      throw new Error("The project changed while preparing the export. Please try again.");
    }
    if (project.chapters.find((chapter) => chapter.id === chapterId)?.status === "deleted"
      || !payload?.languages?.some((language) => language.code === modal.languageCode)) {
      throw new Error("A project file was deleted or no longer has the selected language. Reopen Export to update the file list.");
    }
    const chapterBlocks = buildEditorPreviewDocument(normalizeEditorRows(payload.rows), modal.languageCode);
    if (modal.book) {
      const titled = bookChapterPreviewBlocks(item, chapterBlocks, modal.languageCode);
      headings[chapterId] = titled.slice(1).filter((block) => block.kind === "text" && block.textStyle === "heading1")
        .map((block) => extractInlineMarkupVisibleText(block.text));
      chapterDocuments.set(item.id, titled.map((block, index) => ({ ...block,
        ...(index === 0 && numberChapters && numbers.has(item.id) ? { text: `${numbers.get(item.id)}. ${block.text}` } : {}),
        bookItemId: item.id,
      })));
      item.title = item.titleOverride || bookChapterDefaultTitle(chapterBlocks, item.title);
      continue;
    }
    if (!extractVellumLeadingHeadingTitle(chapterBlocks)) blocks.push({
      kind: "text", rowId: `chapter-title:${chapterId}`, languageCode: modal.languageCode,
      textStyle: "heading1", text: payload.title || payload.fileTitle
        || project.chapters.find((chapter) => chapter.id === chapterId)?.name || "",
      footnotes: [], bookItemId: item.id,
    });
    blocks.push(...chapterBlocks.map((block) => ({ ...block, bookItemId: item.id })));
  }
  return modal.book ? items.flatMap((item) => item.kind === "chapter" ? chapterDocuments.get(item.id) : bookSectionPreviewBlocks(item, modal, items, headings)) : blocks;
}

function bookSectionPreviewBlocks(item, modal, contentsItems, headings) {
  const text = (value, textStyle = "paragraph") => ({ kind: "text", rowId: item.id, languageCode: modal.languageCode, text: value || "", textStyle, footnotes: [] });
  const result = [];
  if (item.kind === "title") result.push(text(item.title, "heading1"), text(item.subtitle, "heading2"), text(item.author, "centered"), text(item.translator, "centered"));
  if (item.kind === "contents") result.push(text(item.title, "heading1"),
    ...bookContentsEntries(contentsItems, headings, item.includeH1Headings).map((entry) => text(entry.title, entry.level ? "indented" : "paragraph")));
  if (["copyright", "dedication"].includes(item.kind)) result.push(...bookTextParts(item.text).map((part) => part.kind === "separator"
    ? { kind: "separator", rowId: item.id, languageCode: modal.languageCode }
    : text(part.text.replaceAll("\u2028", "\n"), item.kind === "dedication" ? "centered" : "paragraph")));
  const source = modal.book.items.find((entry) => entry.id === item.id);
  if (source?.image) result.push({ kind: "image", rowId: item.id, languageCode: modal.languageCode, image: { kind: "upload", path: source.image.assetId, filePath: source.image.vellumFilePath || source.image.filePath, fileName: source.image.fileName }, caption: item.caption || "" });
  return result.map((block) => ({ ...block, bookItemId: item.id }));
}
