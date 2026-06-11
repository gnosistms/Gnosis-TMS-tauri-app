import { formatErrorForDisplay } from "./error-display.js";
import { invoke } from "./runtime.js";
import { findChapterContext, selectedProjectsTeam } from "./project-context.js";
import {
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
  loadStoredEditorExportDefault,
  saveStoredEditorExportDefault,
} from "./editor-export-defaults.js";

export const EDITOR_EXPORT_CATEGORIES = [
  {
    id: "file",
    label: "Save to file",
    options: [
      { id: "file:html", label: "HTML", kind: "file", format: "html", available: true },
      { id: "file:xlsx", label: "XLSX", kind: "file", format: "xlsx", available: true },
      { id: "file:docx", label: "DOCX", kind: "file", format: "docx", available: true },
      { id: "file:txt", label: "TXT", kind: "file", format: "txt", available: true },
      { id: "file:rtf", label: "RTF", kind: "file", format: "rtf", available: true },
      { id: "file:md", label: "Markdown", kind: "file", format: "md", available: true },
    ],
  },
  {
    id: "copy",
    label: "Copy and paste",
    options: [
      { id: "copy:text", label: "Plain text", kind: "copy", format: "text", available: true },
      { id: "copy:html", label: "HTML", kind: "copy", format: "html", available: true },
      { id: "copy:docx", label: "DOCX", kind: "copy", format: "docx", available: false },
    ],
  },
  {
    id: "link",
    label: "Link and transfer",
    options: [
      { id: "link:wordpress", label: "WordPress.com", kind: "link", format: "wordpress", available: true },
      { id: "link:team", label: "Other Gnosis TMS team", kind: "link", format: "team", available: false },
    ],
  },
];

export function findEditorExportOption(optionId) {
  for (const category of EDITOR_EXPORT_CATEGORIES) {
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

function updateEditorExportModal(patch) {
  state.editorChapter = {
    ...state.editorChapter,
    exportModal: {
      ...(currentExportModal() ?? createEditorExportModalState()),
      ...patch,
    },
  };
}

export function openEditorExportOptions(render) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  const previous = currentExportModal() ?? createEditorExportModalState();
  // The last successful export for this chapter wins over the in-session
  // selection; both fall back to the catalog default.
  const stored = loadStoredEditorExportDefault(state.editorChapter.chapterId);
  const storedOption = stored ? findEditorExportOption(stored.optionId) : null;
  const selectedOptionId = storedOption?.available
    ? storedOption.id
    : previous.selectedOptionId;
  const expandedCategoryIds = Array.from(new Set([
    ...(Array.isArray(previous.expandedCategoryIds) ? previous.expandedCategoryIds : []),
    String(selectedOptionId ?? "").split(":")[0],
  ])).filter(Boolean);

  updateEditorExportModal({
    ...createEditorExportModalState(),
    expandedCategoryIds,
    selectedOptionId,
    isOpen: true,
  });
  if (selectedOptionId === "link:wordpress") {
    if (storedOption?.available && stored?.wordpress) {
      seedWordPressOverwriteDefault(stored.wordpress);
    }
    ensureWordPressPaneReady(render);
  }
  render();
}

export function closeEditorExportOptions(render) {
  const modal = currentExportModal();
  if (!modal?.isOpen || modal.status === "exporting") {
    return;
  }

  updateEditorExportModal({ isOpen: false, status: "idle", error: "" });
  render();
}

export function toggleEditorExportCategory(render, categoryId) {
  const modal = currentExportModal();
  if (!modal?.isOpen || !EDITOR_EXPORT_CATEGORIES.some((category) => category.id === categoryId)) {
    return;
  }

  const expanded = Array.isArray(modal.expandedCategoryIds) ? modal.expandedCategoryIds : [];
  updateEditorExportModal({
    expandedCategoryIds: expanded.includes(categoryId)
      ? expanded.filter((id) => id !== categoryId)
      : [...expanded, categoryId],
  });
  render();
}

export function selectEditorExportOption(render, optionId) {
  const modal = currentExportModal();
  if (!modal?.isOpen || modal.status === "exporting" || !findEditorExportOption(optionId)) {
    return;
  }

  updateEditorExportModal({ selectedOptionId: optionId, error: "" });
  if (optionId === "link:wordpress") {
    ensureWordPressPaneReady(render);
  }
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
  updateEditorExportModal({ status: "idle", error: formatErrorForDisplay(error) });
  render();
}

async function submitEditorFileExport(render, option, operations) {
  const saveDialog = operations.saveDialog ?? saveExportFilePath;
  const invokeCommand = operations.invoke ?? invoke;
  const waitForRepoQueue = operations.waitForRepoQueue ?? waitForRepoWriteQueueIdle;
  const team = selectedProjectsTeam();
  const context = findChapterContext(state.editorChapter?.chapterId);
  const languageCode = String(selectedEditorPreviewLanguageCode(state.editorChapter) ?? "").trim();

  if (!Number.isFinite(team?.installationId) || !context?.project || !context?.chapter || !languageCode) {
    failEditorExport(render, "Could not find the open file.");
    return;
  }

  const fileBase = sanitizeExportFileName(state.editorChapter?.fileTitle || context.chapter.name);
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

  updateEditorExportModal({ status: "exporting", error: "" });
  render();

  try {
    await waitForRepoQueue(projectRepoScope({ team, project: context.project }));
    await invokeCommand("export_gtms_chapter_file", {
      input: {
        installationId: team.installationId,
        repoName: context.project.name,
        projectId: context.project.id ?? null,
        projectFullName: context.project.fullName ?? "",
        chapterId: context.chapter.id,
        languageCode,
        format: option.format,
        outputPath,
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

async function submitEditorCopyExport(render, option, operations) {
  const writeClipboard = operations.writeClipboard ?? writeClipboardFormats;
  const languageCode = selectedEditorPreviewLanguageCode(state.editorChapter);
  const blocks = buildEditorPreviewDocument(state.editorChapter?.rows, languageCode);
  const plainText = serializeEditorPreviewPlainText(blocks);
  const formats = option.format === "html"
    ? { "text/html": serializeEditorPreviewHtml(blocks), "text/plain": plainText }
    : { "text/plain": plainText };

  if (!plainText && !formats["text/html"]) {
    failEditorExport(render, "Nothing to copy.");
    return;
  }

  updateEditorExportModal({ status: "exporting", error: "" });
  render();

  try {
    await writeClipboard(formats);
    updateEditorExportModal({ isOpen: false, status: "idle", error: "" });
    saveStoredEditorExportDefault(state.editorChapter?.chapterId, { optionId: option.id });
    render();
    showNoticeBadge(option.format === "html" ? "Copied HTML." : "Copied plain text.", render, 1400);
  } catch (error) {
    failEditorExport(render, error);
  }
}

export async function submitEditorExport(render, operations = {}) {
  const modal = currentExportModal();
  if (!modal?.isOpen || modal.status === "exporting") {
    return;
  }

  const option = findEditorExportOption(modal.selectedOptionId);
  if (!option?.available) {
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
  }
}
