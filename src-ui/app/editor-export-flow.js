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
      { id: "link:wordpress", label: "WordPress.com", kind: "link", format: "wordpress", available: true },
      { id: "link:team", label: "Gnosis TMS team", kind: "link", format: "team", available: true },
    ],
  },
];

export { PDF_PAPER_SIZES } from "./editor-export-options.js";

export function editorExportCategories() {
  const mac = isMacPlatform();
  return BASE_EDITOR_EXPORT_CATEGORIES.map((category) => ({
    ...category,
    options: category.options
      .filter((option) => option.platform !== "mac" || mac),
  }));
}

export function findEditorExportOption(optionId) {
  for (const category of editorExportCategories()) {
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
  return modal?.status === "exporting" || modal?.status === "cancelling";
}

function updateEditorExportModal(patch) {
  state.editorChapter = {
    ...state.editorChapter,
    exportModal: {
      ...(currentExportModal() ?? createEditorExportModalState()),
      ...patch,
    },
  };
}

// True when the modal's chapter is the one open in the editor — copy and
// WordPress exports serialize from the editor's in-memory rows, so they are
// only offered then.
export function exportChapterIsOpenInEditor() {
  const chapterId = currentExportModal()?.chapterId;
  return Boolean(chapterId) && state.editorChapter?.chapterId === chapterId;
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
  return `${String(chapterId ?? "")}:${String(languageCode ?? "")}`;
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
      languageCode,
    },
  };
}

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
  updateEditorExportModal({
    pdfFontStatus: "loading",
    pdfFontInspectionKey: request.key,
    pdfFontRequiredBytes: 0,
    pdfFontMissingBytes: 0,
    pdfFontFamilies: [],
    pdfFontMessage: "",
    error: "",
  });
  render();
  try {
    const inspection = await invokeCommand("inspect_gtms_chapter_pdf_fonts", {
      input: request.input,
    });
    if (!inspection || typeof inspection !== "object") {
      updateEditorExportModal({ pdfFontStatus: "idle" });
      render();
      return null;
    }
    const current = currentExportModal();
    if (!current?.isOpen || current.selectedOptionId !== "file:pdf"
      || current.pdfFontInspectionKey !== request.key) {
      return inspection;
    }
    updateEditorExportModal({
      pdfFontStatus: inspection.supported === false ? "unsupported" : "ready",
      pdfFontRequiredBytes: Number(inspection.requiredBytes) || 0,
      pdfFontMissingBytes: Number(inspection.missingBytes) || 0,
      pdfFontFamilies: Array.isArray(inspection.fontFamilies) ? inspection.fontFamilies : [],
      pdfFontMessage: String(inspection.message ?? ""),
      error: "",
    });
    render();
    return inspection;
  } catch (error) {
    if (currentExportModal()?.pdfFontInspectionKey === request.key) {
      updateEditorExportModal({
        pdfFontStatus: "error",
        error: formatErrorForDisplay(error),
      });
      render();
    }
    return null;
  }
}

function openExportOptionsForChapter(render, chapterId, languageCode) {
  const previous = currentExportModal() ?? createEditorExportModalState();
  // The last successful export for this chapter wins over the in-session
  // selection; both fall back to the catalog default.
  const stored = loadStoredEditorExportDefault(chapterId);
  const storedOption = stored ? findEditorExportOption(stored.optionId) : null;
  const previousOption = findEditorExportOption(previous.selectedOptionId);
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
    isOpen: true,
  });
  if (selectedOptionId === "link:wordpress" && exportChapterIsOpenInEditor()) {
    if (storedOption?.available && stored?.wordpress) {
      seedWordPressOverwriteDefault(stored.wordpress);
    }
    ensureWordPressPaneReady(render);
  }
  if (selectedOptionId === "link:team") {
    ensureTeamCopyPaneReady(render);
  }
  render();
  if (selectedOptionId === "file:pdf") {
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

export function selectEditorExportLanguage(render, languageCode) {
  const modal = currentExportModal();
  if (!modal?.isOpen || exportModalIsBusy(modal)) {
    return;
  }

  const normalized = String(languageCode ?? "").trim();
  const chapter = findChapterContext(modal.chapterId)?.chapter;
  const languages = Array.isArray(chapter?.languages) ? chapter.languages : [];
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
  render();
}

export function closeEditorExportOptions(render, operations = {}) {
  const modal = currentExportModal();
  if (!modal?.isOpen || modal.status === "cancelling") {
    return;
  }

  if (modal.status === "exporting") {
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
  if (optionId === "link:wordpress" && exportChapterIsOpenInEditor()) {
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
}

export function toggleEditorExportOmitCustomHtml(render, checked) {
  const modal = currentExportModal();
  if (!modal?.isOpen || exportModalIsBusy(modal)) {
    return;
  }

  updateEditorExportModal({ omitCustomHtml: checked === true, error: "" });
  render();
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
    (exportChapterIsOpenInEditor() && state.editorChapter?.fileTitle) || context.chapter.name,
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
    pdfStage: option.format === "pdf" ? "Preparing the chapter…" : "",
    pdfDownloadedBytes: 0,
    pdfTotalBytes: 0,
    pdfProgressCurrent: 0,
    pdfProgressTotal: 0,
    pdfProgressUnit: "",
    pdfProgressIndeterminate: option.format === "pdf",
    pdfOutputFileName: defaultFileName,
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
    await invokeCommand("export_gtms_chapter_file", {
      input: {
        ...input,
      },
    });
    updateEditorExportModal({ isOpen: false, status: "idle", error: "" });
    saveStoredEditorExportDefault(context.chapter.id, { optionId: option.id });
    // Full render to remove the modal; showNoticeBadge only repaints the
    // badge surface.
    render();
    showNoticeBadge(`Exported ${defaultFileName}.`, render, 2200);
  } catch (error) {
    failEditorExport(render, error);
  }
}

export function handleChapterPdfExportProgress(payload, render) {
  const modal = currentExportModal();
  if (!modal?.isOpen || !modal.pdfJobId || payload?.jobId !== modal.pdfJobId) {
    return;
  }
  if (payload.status === "complete") {
    const chapterId = modal.chapterId;
    const fileName = modal.pdfOutputFileName || "PDF";
    updateEditorExportModal({
      isOpen: false,
      status: "idle",
      error: "",
      pdfJobId: "",
      pdfStartPending: false,
      pdfStage: "",
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
    });
    render();
    return;
  }
  updateEditorExportModal({
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
}

async function submitEditorCopyExport(render, option, operations) {
  const writeClipboard = operations.writeClipboard ?? writeClipboardFormats;
  const copyVellum = operations.copyVellumTextEditorContent ?? copyVellumTextEditorContentToClipboard;
  const prepareVellumImages = operations.prepareVellumImageResources ?? prepareVellumImageResources;
  const languageCode = selectedEditorPreviewLanguageCode(state.editorChapter);
  const context = findChapterContext(currentExportModal()?.chapterId);
  const blocks = buildEditorPreviewDocument(state.editorChapter?.rows, languageCode);
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
      const ogElementPrivateDecodedPropertyListXml = buildVellumOgElementPrivateDecodedXml(vellumBlocks, {
        title: state.editorChapter?.fileTitle || context?.chapter?.name || "",
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
    saveStoredEditorExportDefault(state.editorChapter?.chapterId, { optionId: option.id });
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

export async function submitEditorExport(render, operations = {}) {
  const modal = currentExportModal();
  if (!modal?.isOpen || exportModalIsBusy(modal)) {
    return;
  }

  const option = findEditorExportOption(modal.selectedOptionId);
  if (!option?.available) {
    return;
  }

  // Clipboard and WordPress exports serialize the editor's in-memory rows.
  const needsOpenEditor = option.kind === "copy"
    || (option.kind === "link" && option.format === "wordpress");
  if (needsOpenEditor && !exportChapterIsOpenInEditor()) {
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
    await submitWordPressExport(render, operations);
    return;
  }

  if (option.kind === "link" && option.format === "team") {
    await submitTeamChapterCopy(render, operations);
  }
}
