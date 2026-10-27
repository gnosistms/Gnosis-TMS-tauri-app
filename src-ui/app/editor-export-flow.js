import { cancelBookTitlePreview, requestBookTitlePreview } from "./project-book-title-preview.js";
import { initializeProjectBook, selectProjectBookLanguage, loadSelectedBookPreview } from "./project-book-flow.js";
import { bookChapterDefaultTitle, bookItemIncluded, bookExportItems } from "./project-book-model.js";
import { saveBookSettings } from "./project-book-settings.js";
import { beginBookSettingsSync, leaveBookSettingsPage1 } from "./project-book-settings-sync.js";
import {
  exportDefaultKey, loadProjectExportBlocks, projectExportChapters,
  projectExportScopeInput,
} from "./project-export-context.js";
import { formatErrorForDisplay } from "./error-display.js";
import { invoke, isMacPlatform, listen } from "./runtime.js";
import { findChapterContext, selectedProjectsTeam } from "./project-context.js";
import {
  applyCustomHtmlPlainTextPolicy,
  buildEditorPreviewDocument,
  selectedEditorPreviewLanguageCode,
  serializeEditorPreviewHtml,
  serializeEditorPreviewPlainText,
} from "./editor-preview.js";
import { createEditorExportModalState, state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import { reportPdfFontCoverageGap } from "./telemetry.js";
import {
  projectRepoScope,
  waitForRepoWriteQueueIdle,
} from "./repo-write-queue.js";
import {
  ensureWordPressPaneReady,
  seedWordPressOverwriteDefault,
  submitWordPressExport,
} from "./editor-export-wordpress-flow.js";
import {
  ensureTeamCopyPaneReady,
  submitTeamChapterCopy,
} from "./editor-export-team-copy-flow.js";
import {
  lastStoredWordPressDestination,
  loadStoredEditorExportDefault,
  loadStoredEditorExportPaperSize,
  saveStoredEditorExportDefault,
  saveStoredEditorExportPaperSize,
} from "./editor-export-defaults.js";
import {
  DEFAULT_PDF_PAPER_SIZE,
  isSupportedPdfPaperSize,
} from "./editor-export-options.js";
import {
  copyVellumTextEditorContentToClipboard,
  prepareVellumImageResources,
} from "./vellum-clipboard.js";
import {
  applyPreparedVellumImageResources,
  buildVellumImageResourceRequests,
  buildVellumOgElementPrivateDecodedXml,
  buildVellumTextEditorContentDecodedXml,
} from "./vellum-text-editor-content.js";

const BASE_EDITOR_EXPORT_CATEGORIES = [
  {
    id: "file",
    label: "Save to file",
    options: [
      { id: "file:html", label: "HTML", kind: "file", format: "html", available: true },
      { id: "file:pdf", label: "PDF", kind: "file", format: "pdf", available: true, printLinkFallback: true, omitCustomHtmlOption: true },
      { id: "file:xlsx", label: "XLSX", kind: "file", format: "xlsx", available: true, omitCustomHtmlOption: true },
      { id: "file:docx", label: "DOCX", kind: "file", format: "docx", available: true, printLinkFallback: true, omitCustomHtmlOption: true },
      { id: "file:txt", label: "TXT", kind: "file", format: "txt", available: true, omitCustomHtmlOption: true },
      { id: "file:srt", label: "SRT", kind: "file", format: "srt", available: true, requiresSourceFormat: "srt" },
      { id: "file:rtf", label: "RTF", kind: "file", format: "rtf", available: true, printLinkFallback: true, omitCustomHtmlOption: true },
      { id: "file:md", label: "Markdown", kind: "file", format: "md", available: true, omitCustomHtmlOption: true },
    ],
  },
  {
    id: "copy",
    label: "Copy and paste",
    options: [
      { id: "copy:text", label: "Plain text", kind: "copy", format: "text", available: true, printLinkFallback: true, omitCustomHtmlOption: true },
      { id: "copy:html", label: "HTML", kind: "copy", format: "html", available: true },
      { id: "copy:vellum", label: "Vellum", kind: "copy", format: "vellum", available: true, platform: "mac", printLinkFallback: true, omitCustomHtmlOption: true },
      { id: "copy:docx", label: "DOCX", kind: "copy", format: "docx", available: false },
    ],
  },
  {
    id: "link",
    label: "Link and transfer",
    options: [
      { id: "link:wordpress", label: "WordPress", kind: "link", format: "wordpress", available: true },
      { id: "link:team", label: "Gnosis TMS team", kind: "link", format: "team", available: true },
    ],
  },
];

export { PDF_PAPER_SIZES } from "./editor-export-options.js";

// Source formats of the chapter the export modal is showing. The open editor's
// chapter payload wins; otherwise the projects-page chapter summary supplies it.
function exportChapterSourceFormats(modal = currentExportModal()) {
  if (modal?.projectId) {
    const project = state.projects.find((entry) => entry.id === modal.projectId);
    const chapters = modal.chapterIds.map((id) => project?.chapters?.find((chapter) => chapter.id === id));
    return chapters.length && chapters.every((chapter) => chapter?.sourceFormats?.includes("srt")) ? ["srt"] : [];
  }
  const chapterId = modal?.chapterId;
  if (!chapterId) {
    return [];
  }
  if (
    state.editorChapter?.chapterId === chapterId
    && Array.isArray(state.editorChapter?.sourceFormats)
  ) {
    return state.editorChapter.sourceFormats;
  }
  const chapter = findChapterContext(chapterId)?.chapter;
  return Array.isArray(chapter?.sourceFormats) ? chapter.sourceFormats : [];
}

export function editorExportCategories(modal = currentExportModal()) {
  const mac = isMacPlatform();
  const sourceFormats = exportChapterSourceFormats(modal);
  return BASE_EDITOR_EXPORT_CATEGORIES.map((category) => ({
    ...category,
    options: category.options
      .filter((option) => option.platform !== "mac" || mac)
      .filter((option) => !modal?.projectId || option.id !== "link:team")
      // Provenance-gated options (SRT) are hidden entirely for chapters that
      // were not imported from that format.
      .filter(
        (option) =>
          !option.requiresSourceFormat
          || sourceFormats.includes(option.requiresSourceFormat),
      ),
  }));
}

export function findEditorExportOption(optionId, modal = currentExportModal()) {
  for (const category of editorExportCategories(modal)) {
    const option = category.options.find((entry) => entry.id === optionId);
    if (option) {
      return option;
    }
  }
  return null;
}

function currentExportModal() {
  return state.editorChapter?.exportModal ?? null;
}

function exportModalIsBusy(modal) {
  return modal?.status === "exporting" || modal?.status === "cancelling"
    || modal?.status === "reviewing-fonts" || Boolean(modal?.pdfForgettingFontId);
}

function updateEditorExportModal(patch) {
  state.editorChapter = {
    ...state.editorChapter,
    exportModal: {
      ...(currentExportModal() ?? createEditorExportModalState()),
      ...patch,
    },
  };
  saveBookSettings(currentExportModal());
}

// Chapter clipboard/WordPress exports use the open editor. Project exports
// instead load every chapter through the native storage boundary.
export function exportChapterIsOpenInEditor() {
  const chapterId = currentExportModal()?.chapterId;
  return !currentExportModal()?.projectId && Boolean(chapterId) && state.editorChapter?.chapterId === chapterId;
}

// Export language outside the editor follows the project-export default:
// the chapter's remembered target language, else the first target, else the
// first language.
function defaultExportLanguageCode(chapter) {
  const languages = Array.isArray(chapter?.languages) ? chapter.languages : [];
  const selectedTarget = String(chapter?.selectedTargetLanguageCode ?? "").trim();
  if (selectedTarget && languages.some((language) => language?.code === selectedTarget)) {
    return selectedTarget;
  }
  return (
    languages.find((language) => language?.role === "target")?.code
    ?? languages[0]?.code
    ?? ""
  );
}

function currentExportLanguageCode() {
  if (exportChapterIsOpenInEditor()) {
    return String(selectedEditorPreviewLanguageCode(state.editorChapter) ?? "").trim();
  }
  return String(currentExportModal()?.languageCode ?? "").trim();
}

function pdfFontInspectionKey(chapterId, languageCode) {
  const modal = currentExportModal();
  return `${modal?.projectId ? JSON.stringify(projectExportScopeInput(modal)) : String(chapterId ?? "")}:${String(languageCode ?? "")}:${modal?.omitCustomHtml === true}:${modal?.footnoteLinksAsPlainText === true}`;
}

function pdfFontInspectionInput() {
  const modal = currentExportModal();
  const team = selectedProjectsTeam();
  const context = findChapterContext(modal?.chapterId);
  const languageCode = currentExportLanguageCode();
  if (!Number.isFinite(team?.installationId) || !context?.project || !context?.chapter || !languageCode) {
    return null;
  }
  return {
    key: pdfFontInspectionKey(context.chapter.id, languageCode),
    input: {
      installationId: team.installationId,
      repoName: context.project.name,
      projectId: context.project.id ?? null,
      projectFullName: context.project.fullName ?? "",
      chapterId: context.chapter.id,
      ...projectExportScopeInput(modal),
      languageCode,
      omitCustomHtml: modal.omitCustomHtml === true,
      footnoteLinksAsPlainText: modal.footnoteLinksAsPlainText === true,
    },
  };
}

let pdfFontInspectionRequestId = 0;

export async function refreshPdfFontInspection(render, operations = {}) {
  const modal = currentExportModal();
  if (!modal?.isOpen || modal.selectedOptionId !== "file:pdf" || exportModalIsBusy(modal)) {
    return null;
  }
  const request = pdfFontInspectionInput();
  const invokeCommand = operations.invoke ?? invoke;
  if (!request || typeof invokeCommand !== "function") {
    return null;
  }
  const requestId = ++pdfFontInspectionRequestId;
  const isCurrent = () => {
    const current = currentExportModal();
    return current?.isOpen && current.selectedOptionId === "file:pdf"
      && current.pdfFontInspectionKey === request.key && current.pdfFontInspectionRequestId === requestId;
  };
  updateEditorExportModal({
    pdfFontStatus: "loading",
    pdfFontInspectionKey: request.key,
    pdfFontRequiredBytes: 0,
    pdfFontMissingBytes: 0,
    pdfFontFamilies: [],
    pdfFontMessage: "",
    pdfSavedFallbackFonts: [],
    pdfFontInspectionRequestId: requestId,
    error: "",
  });
  render();
  try {
    const context = findChapterContext(modal.chapterId);
    await (operations.waitForRepoQueue ?? waitForRepoWriteQueueIdle)(
      projectRepoScope({ team: selectedProjectsTeam(), project: context?.project }),
    );
    if (!isCurrent()) { return null; }
    const inspection = await invokeCommand("inspect_gtms_chapter_pdf_fonts", {
      input: request.input,
    });
    if (!isCurrent()) { return inspection; }
    if (!inspection || typeof inspection !== "object") {
      updateEditorExportModal({ pdfFontStatus: "idle" });
      render();
      return null;
    }
    updateEditorExportModal({
      pdfFontStatus: inspection.supported === false ? "unsupported" : "ready",
      pdfFontRequiredBytes: Number(inspection.requiredBytes) || 0,
      pdfFontMissingBytes: Number(inspection.missingBytes) || 0,
      pdfFontFamilies: Array.isArray(inspection.fontFamilies) ? inspection.fontFamilies : [],
      pdfFontMessage: String(inspection.message ?? ""),
      pdfSavedFallbackFonts: Array.isArray(inspection.savedFallbackFonts) ? inspection.savedFallbackFonts : [],
      error: "",
    });
    render();
    return inspection;
  } catch (error) {
    if (isCurrent()) {
      updateEditorExportModal({
        pdfFontStatus: "error",
        error: formatErrorForDisplay(error),
      });
      render();
    }
    return null;
  }
}

export function togglePdfSavedFonts(render) {
  const modal = currentExportModal();
  if (!modal?.isOpen || exportModalIsBusy(modal) || !modal.pdfSavedFallbackFonts?.length) { return; }
  updateEditorExportModal({ pdfSavedFontsExpanded: !modal.pdfSavedFontsExpanded });
  render();
}

export async function forgetPdfFontApproval(render, fontId, operations = {}) {
  const modal = currentExportModal();
  if (!modal?.isOpen || exportModalIsBusy(modal)
    || !modal.pdfSavedFallbackFonts?.some((font) => font.id === fontId)) { return; }
  const key = modal.pdfFontInspectionKey;
  updateEditorExportModal({ pdfForgettingFontId: fontId, error: "" });
  render();
  const isCurrent = () => currentExportModal()?.isOpen
    && currentExportModal()?.pdfFontInspectionKey === key && currentExportModal()?.pdfForgettingFontId === fontId;
  try {
    await (operations.invoke ?? invoke)("forget_gtms_pdf_font_approval", { fontId });
    if (!isCurrent()) { return; }
    updateEditorExportModal({ pdfForgettingFontId: "" });
    await refreshPdfFontInspection(render, operations);
  } catch (error) {
    if (!isCurrent()) { return; }
    updateEditorExportModal({ pdfForgettingFontId: "", error: formatErrorForDisplay(error) });
    render();
  }
}

function openExportOptionsForChapter(render, chapterId, languageCode, projectScope = {}) {
  const previous = currentExportModal() ?? createEditorExportModalState();
  // The last successful export for this chapter wins over the in-session
  // selection; both fall back to the catalog default.
  const stored = loadStoredEditorExportDefault(exportDefaultKey({ chapterId, ...projectScope }));
  const scope = { chapterId, ...projectScope };
  const storedOption = stored ? findEditorExportOption(stored.optionId, scope) : null;
  const previousOption = findEditorExportOption(previous.selectedOptionId, scope);
  const storedPdfPaperSize = loadStoredEditorExportPaperSize();
  const pdfPaperSize = isSupportedPdfPaperSize(storedPdfPaperSize)
    ? storedPdfPaperSize
    : createEditorExportModalState().pdfPaperSize;
  const selectedOptionId = storedOption?.available
    ? storedOption.id
    : previousOption?.available
      ? previousOption.id
      : createEditorExportModalState().selectedOptionId;
  const expandedCategoryIds = Array.from(new Set([
    ...(Array.isArray(previous.expandedCategoryIds) ? previous.expandedCategoryIds : []),
    String(selectedOptionId ?? "").split(":")[0],
  ])).filter(Boolean);

  updateEditorExportModal({
    ...createEditorExportModalState(),
    pdfPaperSize,
    expandedCategoryIds,
    selectedOptionId,
    chapterId,
    languageCode,
    ...projectScope,
    isOpen: true,
  });
  if (currentExportModal()?.selectedOptionId === "link:wordpress" && (projectScope.projectId || exportChapterIsOpenInEditor())) {
    const destination = lastStoredWordPressDestination(stored?.wordpress);
    if (storedOption?.available && destination) seedWordPressOverwriteDefault(destination);
    ensureWordPressPaneReady(render);
  }
  if (currentExportModal()?.selectedOptionId === "link:team") {
    ensureTeamCopyPaneReady(render);
  }
  render();
  if (currentExportModal()?.selectedOptionId === "file:pdf" && currentExportModal()?.page !== 1) {
    void refreshPdfFontInspection(render);
  }
}

export function openEditorExportOptions(render) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  openExportOptionsForChapter(render, state.editorChapter.chapterId, "");
}

// Projects-page entry point: same modal, driven by a chapter context instead
// of the open editor.
export function openChapterExportOptions(render, chapterId) {
  const context = findChapterContext(chapterId);
  if (!context?.project || !context?.chapter) {
    showNoticeBadge("Could not find the selected file.", render, 2200);
    return;
  }

  openExportOptionsForChapter(render, chapterId, defaultExportLanguageCode(context.chapter));
}

export function openProjectExportOptions(render, projectId) {
  const project = state.projects.find((entry) => entry.id === projectId);
  const chapters = projectExportChapters(project);
  if (!project || !chapters.length) {
    showNoticeBadge("There are no files to export in this project.", render, 2200);
    return;
  }
  const { savedOptions, ...composition } = initializeProjectBook(project, chapters, defaultExportLanguageCode(chapters[0]));
  const scope = {
    projectId, projectTitle: project.title || project.name, ...composition,
    chapterIds: composition.book.items.filter((item) => item.kind === "chapter" && bookItemIncluded(item)).map((item) => item.chapterId),
    ...savedOptions,
    wordpress: { ...createEditorExportModalState().wordpress, ...savedOptions.wordpress },
  };
  if (scope.selectedOptionId === "link:team") scope.selectedOptionId = "file:pdf";
  openExportOptionsForChapter(render, chapters[0].id, composition.languageCode, scope);
  beginBookSettingsSync(render);
  void loadSelectedBookPreview(render);

}

export function selectEditorExportLanguage(render, languageCode) {
  const modal = currentExportModal();
  if (!modal?.isOpen || exportModalIsBusy(modal)) {
    return;
  }

  const normalized = String(languageCode ?? "").trim();
  if (modal.book) { selectProjectBookLanguage(render, normalized); return; }
  const chapter = findChapterContext(modal.chapterId)?.chapter;
  const languages = modal.projectId ? modal.languages : (Array.isArray(chapter?.languages) ? chapter.languages : []);
  updateEditorExportModal({
    languageCode: languages.some((language) => language?.code === normalized) ? normalized : "",
    error: "",
    pdfFontStatus: "idle",
    pdfFontInspectionKey: "",
  });
  render();
  if (currentExportModal()?.selectedOptionId === "file:pdf") {
    void refreshPdfFontInspection(render);
  }
}

export function selectEditorExportPaperSize(render, paperSize) {
  const modal = currentExportModal();
  const normalized = String(paperSize ?? "").trim();
  if (!modal?.isOpen || exportModalIsBusy(modal)
    || !isSupportedPdfPaperSize(normalized)) {
    return;
  }

  updateEditorExportModal({ pdfPaperSize: normalized, error: "" });
  saveStoredEditorExportPaperSize(normalized);
  if (modal.book) saveBookSettings(currentExportModal());
  render();
  requestBookTitlePreview(render);
}

export function closeEditorExportOptions(render, operations = {}) {
  cancelBookTitlePreview();
  const modal = currentExportModal();
  if (!modal?.isOpen || modal.status === "cancelling") {
    return;
  }

  if (modal.status === "exporting" || modal.status === "reviewing-fonts") {
    if (!modal.pdfJobId) {
      return;
    }
    if (modal.pdfStartPending) {
      updateEditorExportModal({
        isOpen: false,
        status: "idle",
        pdfJobId: "",
        pdfStartPending: false,
        pdfStage: "",
      });
      render();
      return;
    }
    const invokeCommand = operations.invoke ?? invoke;
    updateEditorExportModal({
      status: "cancelling",
      pdfStage: "Cancelling PDF export…",
      pdfProgressCurrent: 0,
      pdfProgressTotal: 0,
      pdfProgressUnit: "",
      pdfProgressIndeterminate: true,
    });
    render();
    if (typeof invokeCommand === "function") {
      void invokeCommand("cancel_gtms_chapter_pdf_export", { jobId: modal.pdfJobId })
        .catch((error) => failEditorExport(render, error));
    }
    return;
  }

  leaveBookSettingsPage1(render);
  updateEditorExportModal({ isOpen: false, status: "idle", error: "" });
  render();
}

export function toggleEditorExportCategory(render, categoryId) {
  const modal = currentExportModal();
  const category = editorExportCategories().find((entry) => entry.id === categoryId);
  if (!modal?.isOpen || exportModalIsBusy(modal) || !category) {
    return;
  }

  const expanded = Array.isArray(modal.expandedCategoryIds) ? modal.expandedCategoryIds : [];
  const wasExpanded = expanded.includes(categoryId);
  const nextPatch = {
    expandedCategoryIds: wasExpanded
      ? expanded.filter((id) => id !== categoryId)
      : [...expanded, categoryId],
  };

  if (!wasExpanded && categoryId === "copy") {
    const firstAvailableOption = category.options.find((option) => option.available === true);
    if (firstAvailableOption) {
      nextPatch.selectedOptionId = firstAvailableOption.id;
      nextPatch.error = "";
    }
  }

  updateEditorExportModal(nextPatch);
  render();
}

export function selectEditorExportOption(render, optionId) {
  const modal = currentExportModal();
  if (!modal?.isOpen || exportModalIsBusy(modal) || !findEditorExportOption(optionId)) {
    return;
  }

  updateEditorExportModal({ selectedOptionId: optionId, error: "" });
  if (optionId === "link:wordpress" && (modal.projectId || exportChapterIsOpenInEditor())) {
    ensureWordPressPaneReady(render);
  }
  if (optionId === "link:team") {
    ensureTeamCopyPaneReady(render);
  }
  render();
  if (optionId === "file:pdf") {
    void refreshPdfFontInspection(render);
  }
}

export function toggleEditorExportFootnoteLinks(render, checked) {
  const modal = currentExportModal();
  if (!modal?.isOpen || exportModalIsBusy(modal)) {
    return;
  }

  updateEditorExportModal({ footnoteLinksAsPlainText: checked === true, error: "" });
  render();
  if (modal.selectedOptionId === "file:pdf") { void refreshPdfFontInspection(render); }
}

export function toggleEditorExportOmitCustomHtml(render, checked) {
  const modal = currentExportModal();
  if (!modal?.isOpen || exportModalIsBusy(modal)) {
    return;
  }

  updateEditorExportModal({ omitCustomHtml: checked === true, error: "" });
  render();
  if (modal.selectedOptionId === "file:pdf") { void refreshPdfFontInspection(render); }
}

function sanitizeExportFileName(value) {
  const normalized = String(value ?? "")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/\.+$/g, "")
    .trim();
  return normalized || "chapter";
}

function exportFileFilter(format) {
  if (format === "pdf") {
    return { name: "PDF document", extensions: ["pdf"] };
  }
  if (format === "docx") {
    return { name: "DOCX document", extensions: ["docx"] };
  }
  if (format === "html") {
    return { name: "HTML document", extensions: ["html"] };
  }
  if (format === "xlsx") {
    return { name: "XLSX workbook", extensions: ["xlsx"] };
  }
  if (format === "rtf") {
    return { name: "RTF document", extensions: ["rtf"] };
  }
  if (format === "md") {
    return { name: "Markdown document", extensions: ["md"] };
  }
  if (format === "srt") {
    return { name: "SRT subtitles", extensions: ["srt"] };
  }
  return { name: "Plain text", extensions: ["txt"] };
}

async function saveExportFilePath(options) {
  const save = window.__TAURI__?.dialog?.save;
  if (typeof save !== "function") {
    throw new Error("The native file save dialog is not available.");
  }
  return save(options);
}

export async function writeClipboardFormats(formats) {
  const entries = Object.entries(formats ?? {})
    .filter(([, value]) => typeof value === "string" && value.length > 0);
  if (entries.length === 0) {
    throw new Error("Nothing to copy.");
  }
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    throw new Error("Clipboard access is not available.");
  }

  if (
    typeof navigator.clipboard.write === "function"
    && typeof ClipboardItem !== "undefined"
    && typeof Blob !== "undefined"
  ) {
    await navigator.clipboard.write([
      new ClipboardItem(Object.fromEntries(
        entries.map(([type, value]) => [type, new Blob([value], { type })]),
      )),
    ]);
    return;
  }

  if (typeof navigator.clipboard.writeText === "function") {
    const plainEntry = entries.find(([type]) => type === "text/plain") ?? entries[0];
    await navigator.clipboard.writeText(plainEntry[1]);
    return;
  }

  throw new Error("Clipboard access is not available.");
}

function failEditorExport(render, error) {
  updateEditorExportModal({
    status: "idle",
    error: formatErrorForDisplay(error),
    pdfJobId: "",
    pdfStartPending: false,
    pdfStage: "",
    pdfProgressIndeterminate: false,
    pdfFontReview: null,
  });
  render();
}

function createPdfExportJobId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `pdf-export-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

async function submitEditorFileExport(render, option, operations) {
  const saveDialog = operations.saveDialog ?? saveExportFilePath;
  const invokeCommand = operations.invoke ?? invoke;
  const waitForRepoQueue = operations.waitForRepoQueue ?? waitForRepoWriteQueueIdle;
  const team = selectedProjectsTeam();
  const context = findChapterContext(currentExportModal()?.chapterId);
  const languageCode = currentExportLanguageCode();

  if (!Number.isFinite(team?.installationId) || !context?.project || !context?.chapter) {
    failEditorExport(render, "Could not find the selected file.");
    return;
  }
  if (!languageCode) {
    failEditorExport(render, "Choose the export language first.");
    return;
  }

  if (option.format === "pdf") {
    const expectedKey = pdfFontInspectionKey(context.chapter.id, languageCode);
    if (currentExportModal()?.pdfFontStatus !== "ready"
      || currentExportModal()?.pdfFontInspectionKey !== expectedKey) {
      await refreshPdfFontInspection(render, { invoke: invokeCommand });
    }
    const inspectedModal = currentExportModal();
    if (inspectedModal?.pdfFontStatus === "unsupported") {
      failEditorExport(render, inspectedModal.pdfFontMessage || "PDF export does not support this language yet.");
      return;
    }
    if (inspectedModal?.pdfFontStatus !== "ready") {
      if (!inspectedModal?.error) {
        failEditorExport(render, "Could not verify the PDF fonts. Try again.");
      }
      return;
    }
  }

  const fileBase = sanitizeExportFileName(
    currentExportModal()?.projectTitle || (exportChapterIsOpenInEditor() && state.editorChapter?.fileTitle) || context.chapter.name,
  );
  const defaultFileName = `${fileBase}-${languageCode}.${option.format}`;
  let outputPath = null;
  try {
    outputPath = await saveDialog({
      title: `Export ${fileBase}`,
      defaultPath: defaultFileName,
      filters: [exportFileFilter(option.format)],
    });
  } catch (error) {
    failEditorExport(render, error);
    return;
  }

  if (!outputPath) {
    return;
  }

  const pdfJobId = option.format === "pdf" ? createPdfExportJobId() : "";
  updateEditorExportModal({
    status: "exporting",
    error: "",
    pdfJobId,
    pdfStartPending: option.format === "pdf",
    pdfStage: option.format === "pdf" ? (currentExportModal()?.projectId ? "Preparing the project…" : "Preparing the chapter…") : "",
    pdfDownloadedBytes: 0,
    pdfTotalBytes: 0,
    pdfProgressCurrent: 0,
    pdfProgressTotal: 0,
    pdfProgressUnit: "",
    pdfProgressIndeterminate: option.format === "pdf",
    pdfOutputFileName: defaultFileName,
    pdfFontReview: null,
  });
  render();

  try {
    await waitForRepoQueue(projectRepoScope({ team, project: context.project }));
    if (option.format === "pdf") {
      const latestModal = currentExportModal();
      if (!latestModal?.isOpen || latestModal.status !== "exporting"
        || latestModal.pdfJobId !== pdfJobId) {
        return;
      }
      updateEditorExportModal({ pdfStartPending: false });
    }
    const input = {
      ...(pdfJobId ? { jobId: pdfJobId } : {}),
      installationId: team.installationId,
      repoName: context.project.name,
      projectId: context.project.id ?? null,
      projectFullName: context.project.fullName ?? "",
      chapterId: context.chapter.id,
      ...projectExportScopeInput(currentExportModal()),
      languageCode,
      format: option.format,
      outputPath,
      ...(option.format === "pdf"
        ? { paperSize: currentExportModal()?.pdfPaperSize || DEFAULT_PDF_PAPER_SIZE }
        : {}),
      footnoteLinksAsPlainText:
        option.printLinkFallback === true
        && currentExportModal()?.footnoteLinksAsPlainText === true,
      omitCustomHtml:
        option.omitCustomHtmlOption === true
        && currentExportModal()?.omitCustomHtml === true,
    };
    if (option.format === "pdf") {
      await invokeCommand("start_gtms_chapter_pdf_export", { input });
      if (currentExportModal()?.status === "cancelling"
        && currentExportModal()?.pdfJobId === pdfJobId) {
        await invokeCommand("cancel_gtms_chapter_pdf_export", { jobId: pdfJobId });
      }
      return;
    }
    const exportResult = await invokeCommand("export_gtms_chapter_file", {
      input: {
        ...input,
      },
    });
    updateEditorExportModal({ isOpen: false, status: "idle", error: "" });
    saveStoredEditorExportDefault(exportDefaultKey(), { optionId: option.id });
    // Full render to remove the modal; showNoticeBadge only repaints the
    // badge surface.
    render();
    const skippedRowsWithoutTiming = Number(exportResult?.skippedRowsWithoutTiming) || 0;
    showNoticeBadge(
      skippedRowsWithoutTiming > 0
        ? `Exported ${defaultFileName}. ${skippedRowsWithoutTiming} row${skippedRowsWithoutTiming === 1 ? "" : "s"} without timing ${skippedRowsWithoutTiming === 1 ? "was" : "were"} left out.`
        : `Exported ${defaultFileName}.`,
      render,
      skippedRowsWithoutTiming > 0 ? 4200 : 2200,
    );
  } catch (error) {
    failEditorExport(render, error);
  }
}

export function handleChapterPdfExportProgress(payload, render) {
  const modal = currentExportModal();
  if (!modal?.isOpen || !modal.pdfJobId || payload?.jobId !== modal.pdfJobId) {
    return;
  }
  if (payload.status === "font-review") {
    if (modal.status === "cancelling") {
      return;
    }
    updateEditorExportModal({
      status: "reviewing-fonts",
      pdfFontReview: payload.fontReview,
      pdfStage: "",
      pdfProgressIndeterminate: false,
    });
    render();
    return;
  }
  if (payload.status === "complete") {
    const chapterId = exportDefaultKey(modal);
    const fileName = modal.pdfOutputFileName || "PDF";
    updateEditorExportModal({
      isOpen: false,
      status: "idle",
      error: "",
      pdfJobId: "",
      pdfStartPending: false,
      pdfStage: "",
      pdfFontReview: null,
    });
    saveStoredEditorExportDefault(chapterId, { optionId: "file:pdf" });
    render();
    showNoticeBadge(`Exported ${fileName}.`, render, 2200);
    return;
  }
  if (payload.status === "error") {
    failEditorExport(render, payload.message || "The PDF export failed.");
    return;
  }
  if (payload.status === "cancelled") {
    updateEditorExportModal({
      isOpen: false,
      status: "idle",
      error: "",
      pdfJobId: "",
      pdfStartPending: false,
      pdfStage: "",
      pdfFontReview: null,
    });
    render();
    return;
  }
  updateEditorExportModal({
    pdfFontReview: null,
    pdfStage: String(payload.message ?? "Exporting PDF…"),
    pdfDownloadedBytes: Number(payload.downloadedBytes) || 0,
    pdfTotalBytes: Number(payload.totalBytes) || 0,
    pdfProgressCurrent: Number(payload.progressCurrent ?? payload.downloadedBytes) || 0,
    pdfProgressTotal: Number(payload.progressTotal ?? payload.totalBytes) || 0,
    pdfProgressUnit: String(payload.progressUnit ?? (payload.totalBytes ? "bytes" : "")),
    pdfProgressIndeterminate: payload.progressIndeterminate === true,
  });
  render();
}

export async function registerChapterPdfExportListeners(render) {
  if (!listen) {
    return;
  }
  await listen("chapter-pdf-export-progress", (event) => {
    handleChapterPdfExportProgress(event.payload, render);
  });
  await listen("chapter-pdf-font-coverage-gap", (event) => {
    reportPdfFontCoverageGap(event.payload);
  });
}

async function submitEditorCopyExport(render, option, operations) {
  const writeClipboard = operations.writeClipboard ?? writeClipboardFormats;
  const copyVellum = operations.copyVellumTextEditorContent ?? copyVellumTextEditorContentToClipboard;
  const prepareVellumImages = operations.prepareVellumImageResources ?? prepareVellumImageResources;
  const modal = currentExportModal();
  const languageCode = currentExportLanguageCode();
  const context = findChapterContext(currentExportModal()?.chapterId);
  updateEditorExportModal({ status: "exporting", error: "" });
  render();
  let blocks;
  try {
    blocks = modal.projectId
      ? await loadProjectExportBlocks(modal, operations, { numberChapters: option.format !== "vellum" })
      : buildEditorPreviewDocument(state.editorChapter?.rows, languageCode);
  } catch (error) {
    failEditorExport(render, error);
    return;
  }
  const showFootnoteLinkUrls =
    option.printLinkFallback === true
    && currentExportModal()?.footnoteLinksAsPlainText === true;
  const omitCustomHtml =
    option.omitCustomHtmlOption === true
    && currentExportModal()?.omitCustomHtml === true;
  const plainText = serializeEditorPreviewPlainText(blocks, { showFootnoteLinkUrls, omitCustomHtml });
  const html = serializeEditorPreviewHtml(blocks);
  const formats = option.format === "html"
    ? { "text/html": serializeEditorPreviewHtml(blocks), "text/plain": plainText }
    : { "text/plain": plainText };

  if (!plainText && !formats["text/html"] && option.format !== "vellum") {
    failEditorExport(render, "Nothing to copy.");
    return;
  }

  updateEditorExportModal({ status: "exporting", error: "" });
  render();

  try {
    if (option.format === "vellum") {
      // Vellum can't carry raw HTML — drop or flatten custom-HTML rows first.
      const policyBlocks = applyCustomHtmlPlainTextPolicy(blocks, omitCustomHtml);
      const imageRequests = buildVellumImageResourceRequests(policyBlocks);
      const vellumBlocks = imageRequests.length > 0
        ? applyPreparedVellumImageResources(
          policyBlocks,
          await prepareVellumImages({ images: imageRequests }),
        )
        : policyBlocks;
      const decodedPropertyListXml = buildVellumTextEditorContentDecodedXml(vellumBlocks, {
        showFootnoteLinkUrls,
      });
      if (!decodedPropertyListXml) {
        throw new Error("Nothing to copy.");
      }
      const groupedBlocks = new Map();
      if (modal.book) for (const block of vellumBlocks) {
        if (!groupedBlocks.has(block.bookItemId)) groupedBlocks.set(block.bookItemId, []);
        groupedBlocks.get(block.bookItemId).push(block);
      }
      const ogElementPrivateDecodedPropertyListXml = buildVellumOgElementPrivateDecodedXml(vellumBlocks, {
        title: modal.projectTitle || state.editorChapter?.fileTitle || context?.chapter?.name || "",
        ...(modal.book ? { elements: bookExportItems(modal).map((item) => {
          const blocks = groupedBlocks.get(item.id) || [];
          return { ...item, title: item.kind === "chapter" ? bookChapterDefaultTitle(blocks, item.title) : item.title, blocks };
        }) } : {}),
        showFootnoteLinkUrls,
      });
      await copyVellum({
        decodedPropertyListXml,
        ogElementPrivateDecodedPropertyListXml,
        plainText,
        html,
      });
    } else {
      await writeClipboard(formats);
    }
    updateEditorExportModal({ isOpen: false, status: "idle", error: "" });
    saveStoredEditorExportDefault(exportDefaultKey(), { optionId: option.id });
    render();
    const copiedLabel = option.format === "html"
      ? "Copied HTML."
      : option.format === "vellum"
        ? "Copied Vellum."
        : "Copied plain text.";
    showNoticeBadge(copiedLabel, render, 1400);
  } catch (error) {
    failEditorExport(render, error);
  }
}

export async function submitEditorExport(render, operations = {}, options = {}) {
  const modal = currentExportModal();
  if (modal?.isOpen && modal.status === "reviewing-fonts" && modal.pdfFontReview?.reviewId) {
    const jobId = modal.pdfJobId;
    const reviewId = modal.pdfFontReview.reviewId;
    updateEditorExportModal({ status: "exporting", error: "" });
    render();
    try {
      const approved = await (operations.invoke ?? invoke)("approve_gtms_chapter_pdf_fonts", { jobId, reviewId });
      if (!approved && currentExportModal()?.pdfJobId === jobId
        && currentExportModal()?.status === "exporting") {
        failEditorExport(render, "This PDF font review has expired. Please export again.");
      }
    } catch (error) {
      if (currentExportModal()?.pdfJobId === jobId && currentExportModal()?.status === "exporting") {
        // Keep the review and job available for retry or cancellation when the
        // approval command itself fails. Do not start a second export.
        updateEditorExportModal({ status: "reviewing-fonts", error: formatErrorForDisplay(error) });
        render();
      }
    }
    return;
  }
  if (!modal?.isOpen || exportModalIsBusy(modal)) {
    return;
  }

  const option = findEditorExportOption(modal.selectedOptionId);
  if (modal.book && !modal.book.items.some(bookItemIncluded)) {
    failEditorExport(render, "Include at least one item in the export.");
    return;
  }
  if (!option?.available) {
    return;
  }

  if (modal.projectId && option.format !== "team" && !currentExportLanguageCode()) {
    failEditorExport(render, "These files have no export language in common.");
    return;
  }

  // Clipboard exports serialize the editor's in-memory rows. WordPress export
  // requires an open editor, then refreshes it from durable storage first.
  const needsOpenEditor = option.kind === "copy"
    || (option.kind === "link" && option.format === "wordpress");
  if (needsOpenEditor && !modal.projectId && !exportChapterIsOpenInEditor()) {
    failEditorExport(render, "Open the file in the editor to use this export option.");
    return;
  }

  if (option.kind === "file") {
    await submitEditorFileExport(render, option, operations);
    return;
  }

  if (option.kind === "copy") {
    await submitEditorCopyExport(render, option, operations);
    return;
  }

  if (option.kind === "link" && option.format === "wordpress") {
    await submitWordPressExport(render, operations, options);
    return;
  }

  if (option.kind === "link" && option.format === "team") {
    await submitTeamChapterCopy(render, operations);
  }
}
