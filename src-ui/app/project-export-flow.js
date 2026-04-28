import { formatErrorForDisplay } from "./error-display.js";
import { invoke } from "./runtime.js";
import { findChapterContext, selectedProjectsTeam } from "./project-context.js";
import { createProjectExportState, state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";

const SUPPORTED_EXPORT_FORMATS = new Set(["docx", "txt", "html"]);
const UNSUPPORTED_EXPORT_FORMATS = new Set(["xlsx", "srt"]);

function normalizeFormat(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeLanguages(languages) {
  return (Array.isArray(languages) ? languages : [])
    .map((language) => ({
      code: String(language?.code ?? "").trim(),
      name: String(language?.name ?? "").trim(),
      role: String(language?.role ?? "").trim(),
    }))
    .filter((language) => language.code);
}

function defaultExportLanguage(chapter, languages) {
  const selectedTarget = String(chapter?.selectedTargetLanguageCode ?? "").trim();
  if (selectedTarget && languages.some((language) => language.code === selectedTarget)) {
    return selectedTarget;
  }

  return (
    languages.find((language) => language.role === "target")?.code
    ?? languages[0]?.code
    ?? ""
  );
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

function exportFilter(format) {
  if (format === "docx") {
    return { name: "DOCX document", extensions: ["docx"] };
  }
  if (format === "html") {
    return { name: "HTML document", extensions: ["html"] };
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

export function resetProjectExport() {
  state.projectExport = createProjectExportState();
}

export function openProjectExport(render, chapterId) {
  const context = findChapterContext(chapterId);
  if (!context?.project || !context?.chapter) {
    showNoticeBadge("Could not find the selected file.", render, 2200);
    return;
  }

  const languages = normalizeLanguages(context.chapter.languages);
  state.projectExport = {
    ...createProjectExportState(),
    isOpen: true,
    chapterId: context.chapter.id ?? "",
    projectId: context.project.id ?? "",
    repoName: context.project.name ?? "",
    projectFullName: context.project.fullName ?? "",
    chapterName: context.chapter.name ?? "chapter",
    languages,
    languageCode: defaultExportLanguage(context.chapter, languages),
  };
  render();
}

export function cancelProjectExport(render) {
  resetProjectExport();
  render();
}

export function selectProjectExportFormat(render, format) {
  const normalized = normalizeFormat(format);
  if (!state.projectExport?.isOpen) {
    return;
  }

  if (UNSUPPORTED_EXPORT_FORMATS.has(normalized)) {
    state.projectExport = {
      ...state.projectExport,
      format: "",
      error: "",
      unsupportedFormat: normalized,
      status: "idle",
    };
    render();
    return;
  }

  state.projectExport = {
    ...state.projectExport,
    format: SUPPORTED_EXPORT_FORMATS.has(normalized) ? normalized : "",
    error: "",
    unsupportedFormat: "",
    status: "idle",
    languageCode:
      state.projectExport.languageCode
      || defaultExportLanguage(
        findChapterContext(state.projectExport.chapterId)?.chapter,
        normalizeLanguages(state.projectExport.languages),
      ),
  };
  render();
}

export function selectProjectExportLanguage(render, languageCode) {
  if (!state.projectExport?.isOpen) {
    return;
  }

  const normalizedLanguageCode = String(languageCode ?? "").trim();
  const languages = normalizeLanguages(state.projectExport.languages);
  state.projectExport = {
    ...state.projectExport,
    languageCode: languages.some((language) => language.code === normalizedLanguageCode)
      ? normalizedLanguageCode
      : "",
    error: "",
  };
  render();
}

export function closeProjectExportUnsupported(render) {
  if (!state.projectExport?.isOpen) {
    return;
  }
  state.projectExport = {
    ...state.projectExport,
    format: "",
    error: "",
    unsupportedFormat: "",
    status: "idle",
  };
  render();
}

export async function submitProjectExport(render, operations = {}) {
  const modal = state.projectExport;
  const team = selectedProjectsTeam();
  const format = normalizeFormat(modal?.format);
  const languageCode = String(modal?.languageCode ?? "").trim();
  const saveDialog = operations.saveDialog ?? saveExportFilePath;
  const invokeCommand = operations.invoke ?? invoke;
  const context = findChapterContext(modal?.chapterId);

  if (!modal?.isOpen || !SUPPORTED_EXPORT_FORMATS.has(format) || !languageCode) {
    state.projectExport = {
      ...modal,
      status: "idle",
      error: "Select a file format and export language.",
    };
    render();
    return;
  }

  if (!Number.isFinite(team?.installationId) || !context?.project || !context?.chapter) {
    state.projectExport = {
      ...modal,
      status: "idle",
      error: "Could not find the selected file.",
    };
    render();
    return;
  }

  const defaultFileName = `${sanitizeExportFileName(modal.chapterName)}-${languageCode}.${format}`;
  let outputPath = null;
  try {
    outputPath = await saveDialog({
      title: `Export ${modal.chapterName || "chapter"}`,
      defaultPath: defaultFileName,
      filters: [exportFilter(format)],
    });
  } catch (error) {
    state.projectExport = {
      ...state.projectExport,
      status: "idle",
      error: formatErrorForDisplay(error),
    };
    render();
    return;
  }

  if (!outputPath) {
    return;
  }

  state.projectExport = {
    ...state.projectExport,
    status: "exporting",
    error: "",
  };
  render();

  try {
    await invokeCommand("export_gtms_chapter_file", {
      input: {
        installationId: team.installationId,
        repoName: context.project.name,
        projectId: context.project.id ?? null,
        projectFullName: context.project.fullName ?? "",
        chapterId: context.chapter.id,
        languageCode,
        format,
        outputPath,
      },
    });
    resetProjectExport();
    showNoticeBadge(`Exported ${defaultFileName}.`, render, 2200);
  } catch (error) {
    state.projectExport = {
      ...state.projectExport,
      status: "idle",
      error: formatErrorForDisplay(error),
    };
    render();
  }
}
