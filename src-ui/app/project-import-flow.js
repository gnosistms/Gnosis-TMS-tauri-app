import { invoke, waitForNextPaint } from "./runtime.js";
import {
  beginProjectsPageSync,
  completeProjectsPageSync,
  failProjectsPageSync,
} from "./page-sync.js";
import { saveStoredProjectsForTeam } from "./project-cache.js";
import { state } from "./state.js";
import {
  clearScopedSyncBadge,
  showNoticeBadge,
  showScopedSyncBadge,
} from "./status-feedback.js";
import { reconcileProjectRepoSyncStates } from "./project-repo-sync-flow.js";
import { ensureProjectNotTombstoned, refreshProjectFilesFromDisk } from "./project-chapter-flow.js";
import { openLocalFilePicker } from "./local-file-picker.js";

export const PROJECT_IMPORT_ACCEPT =
  ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.txt,text/plain";

export function detectImportFileType(fileName) {
  const normalized = String(fileName || "").trim().toLowerCase();
  if (normalized.endsWith(".xlsx")) {
    return "xlsx";
  }
  if (normalized.endsWith(".txt")) {
    return "txt";
  }
  return null;
}

function readableImportFileLike(value) {
  return value && typeof value === "object" && typeof value.arrayBuffer === "function";
}

function droppedPathFileLike(value) {
  return value && typeof value === "object" && typeof value.dataBase64 === "string";
}

function importFileName(value, fallback = "file") {
  const name = typeof value?.name === "string" ? value.name.trim() : "";
  return name || fallback;
}

function decodeBase64ToBytes(dataBase64) {
  const normalized = typeof dataBase64 === "string" ? dataBase64.trim() : "";
  if (!normalized) {
    throw new Error("The file could not be read.");
  }

  if (typeof globalThis.atob === "function") {
    const binary = globalThis.atob(normalized);
    return Array.from(binary, (character) => character.charCodeAt(0));
  }

  if (typeof Buffer === "function") {
    return Array.from(Buffer.from(normalized, "base64"));
  }

  throw new Error("Base64 decoding is unavailable.");
}

async function importFileBytes(file) {
  if (readableImportFileLike(file)) {
    return Array.from(new Uint8Array(await file.arrayBuffer()));
  }

  if (droppedPathFileLike(file)) {
    return decodeBase64ToBytes(file.dataBase64);
  }

  throw new Error("The file could not be read.");
}

function projectImportModalState(overrides = {}) {
  return {
    ...state.projectImport,
    ...overrides,
  };
}

function setProjectImportError(render, message) {
  state.projectImport = projectImportModalState({
    status: "error",
    error: message,
  });
  render();
}

function currentSourceLanguageScrollTop() {
  const list = globalThis.document?.querySelector?.("[data-project-import-source-language-list]");
  return Number.isFinite(list?.scrollTop) ? list.scrollTop : 0;
}

function restoreSourceLanguageScrollTop(scrollTop) {
  const restore = () => {
    const list = globalThis.document?.querySelector?.("[data-project-import-source-language-list]");
    if (list && Number.isFinite(scrollTop)) {
      list.scrollTop = scrollTop;
    }
  };

  if (typeof globalThis.requestAnimationFrame === "function") {
    globalThis.requestAnimationFrame(restore);
    return;
  }

  if (typeof globalThis.setTimeout === "function") {
    globalThis.setTimeout(restore, 0);
    return;
  }

  restore();
}

export function buildImportedFileEntry(result) {
  const selectedSourceLanguageCode = result.selectedSourceLanguageCode ?? result.languages?.[0]?.code ?? null;
  const selectedTargetLanguageCode =
    result.selectedTargetLanguageCode
    ?? result.languages?.find((language) => language.code !== selectedSourceLanguageCode)?.code
    ?? null;
  const sourceWordCount =
    selectedSourceLanguageCode && result.sourceWordCounts
      ? Number(result.sourceWordCounts[selectedSourceLanguageCode] ?? 0)
      : 0;

  return {
    id: result.chapterId,
    name: result.fileTitle,
    status: "active",
    languages: Array.isArray(result.languages) ? result.languages : [],
    sourceWordCounts:
      result.sourceWordCounts && typeof result.sourceWordCounts === "object"
        ? result.sourceWordCounts
        : {},
    selectedSourceLanguageCode,
    selectedTargetLanguageCode,
    sourceWordCount,
  };
}

function applyImportedFileToProject(team, projectId, result) {
  const importedFile = buildImportedFileEntry(result);
  const mergeImportedFile = (project) => {
    if (!project || project.id !== projectId) {
      return project;
    }

    const existingFiles = Array.isArray(project.chapters) ? project.chapters : [];
    const nextFiles = existingFiles.some((chapter) => chapter.id === importedFile.id)
      ? existingFiles.map((chapter) => (chapter.id === importedFile.id ? importedFile : chapter))
      : [...existingFiles, importedFile];

    return {
      ...project,
      chapters: nextFiles,
    };
  };

  state.projects = state.projects.map(mergeImportedFile);
  state.deletedProjects = state.deletedProjects.map(mergeImportedFile);
  state.expandedProjects.add(projectId);
  saveStoredProjectsForTeam(team, {
    projects: state.projects,
    deletedProjects: state.deletedProjects,
  });
}

export function openProjectImportModal(render, projectId) {
  if (state.projectImport.status === "importing") {
    return;
  }

  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  const targetProject =
    state.projects.find((project) => project.id === projectId) ??
    state.deletedProjects.find((project) => project.id === projectId);
  if (!Number.isFinite(selectedTeam?.installationId) || !targetProject) {
    showNoticeBadge("Could not determine which project to add the file to.", render);
    return;
  }

  if (state.offline?.isEnabled === true) {
    showNoticeBadge("You cannot add files while offline.", render);
    return;
  }

  if (selectedTeam.canManageProjects !== true) {
    showNoticeBadge("You do not have permission to add files in this team.", render);
    return;
  }

  state.projectImport = {
    ...state.projectImport,
    isOpen: true,
    projectId: targetProject.id,
    projectTitle: targetProject.title ?? targetProject.name ?? "",
    status: "idle",
    error: "",
    pendingFile: null,
    pendingFileName: "",
    selectedSourceLanguageCode: "",
    sourceLanguageScrollTop: 0,
  };
  render();
}

export function cancelProjectImportModal(render) {
  if (state.projectImport.status === "importing") {
    return;
  }

  state.projectImport = {
    ...state.projectImport,
    isOpen: false,
    projectId: null,
    projectTitle: "",
    status: "idle",
    error: "",
    pendingFile: null,
    pendingFileName: "",
    selectedSourceLanguageCode: "",
    sourceLanguageScrollTop: 0,
  };
  render();
}

export async function selectProjectImportFile(render) {
  if (state.projectImport.status === "importing" || !state.projectImport.isOpen) {
    return;
  }

  const selectedFile = await openLocalFilePicker({
    accept: PROJECT_IMPORT_ACCEPT,
  });
  if (!selectedFile) {
    return;
  }

  await importProjectFile(render, selectedFile);
}

export async function addFilesToProject(render, projectId) {
  openProjectImportModal(render, projectId);
}

export function selectProjectImportSourceLanguage(render, languageCode) {
  if (state.projectImport.status !== "selectingSourceLanguage") {
    return;
  }

  const code = String(languageCode ?? "").trim().toLowerCase();
  const previousCode = String(state.projectImport.selectedSourceLanguageCode ?? "").trim().toLowerCase();
  const scrollTop = currentSourceLanguageScrollTop();
  state.projectImport = projectImportModalState({
    selectedSourceLanguageCode: previousCode === code ? "" : code,
    sourceLanguageScrollTop: scrollTop,
    error: "",
  });
  render();
  restoreSourceLanguageScrollTop(scrollTop);
}

export async function continueProjectImportText(render) {
  if (state.projectImport.status !== "selectingSourceLanguage" || !state.projectImport.pendingFile) {
    return;
  }

  const sourceLanguageCode = String(state.projectImport.selectedSourceLanguageCode ?? "").trim().toLowerCase();
  if (!sourceLanguageCode) {
    return;
  }

  await importProjectFile(render, state.projectImport.pendingFile, {
    confirmedSourceLanguageCode: sourceLanguageCode,
  });
}

async function completeProjectImport(render, selectedFile, fileType, options = {}) {
  if (state.projectImport.status === "importing") {
    return;
  }

  const projectId = state.projectImport.projectId;
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  const targetProject =
    state.projects.find((project) => project.id === projectId) ??
    state.deletedProjects.find((project) => project.id === projectId);
  if (!Number.isFinite(selectedTeam?.installationId) || !targetProject) {
    showNoticeBadge("Could not determine which project to add the file to.", render);
    return;
  }

  if (await ensureProjectNotTombstoned(render, selectedTeam, targetProject)) {
    return;
  }

  const sourceFileName = importFileName(selectedFile);
  state.projectImport = projectImportModalState({
    status: "importing",
    error: "",
  });
  beginProjectsPageSync();
  showScopedSyncBadge("projects", "Adding file...", render);
  render();
  await waitForNextPaint();

  try {
    const bytes = await importFileBytes(selectedFile);
    let result;
    if (fileType === "xlsx") {
      result = await invoke("import_xlsx_to_gtms", {
        input: {
          installationId: selectedTeam.installationId,
          projectId: targetProject.id,
          repoName: targetProject.name,
          fileName: sourceFileName,
          bytes,
        },
      });
    }
    if (fileType === "txt") {
      result = await invoke("import_txt_to_gtms", {
        input: {
          installationId: selectedTeam.installationId,
          projectId: targetProject.id,
          repoName: targetProject.name,
          fileName: sourceFileName,
          bytes,
          sourceLanguageCode: options.confirmedSourceLanguageCode,
        },
      });
    }

    state.projectImport = {
      ...state.projectImport,
      isOpen: false,
      projectId: null,
      projectTitle: "",
      status: "ready",
      error: "",
      result,
      pendingFile: null,
      pendingFileName: "",
      selectedSourceLanguageCode: "",
      sourceLanguageScrollTop: 0,
    };
    applyImportedFileToProject(selectedTeam, projectId, result);
    render();
    await waitForNextPaint();
    await reconcileProjectRepoSyncStates(render, selectedTeam, [targetProject]);
    await refreshProjectFilesFromDisk(render, selectedTeam, [targetProject]);
    await completeProjectsPageSync(render);
    showNoticeBadge(
      `Imported ${result.unitCount} rows from ${result.sourceFileName} into ${result.projectTitle}`,
      render,
    );
  } catch (error) {
    state.projectImport = projectImportModalState({
      status: "error",
      error: error instanceof Error ? error.message : String(error),
      pendingFile: null,
      pendingFileName: "",
      selectedSourceLanguageCode: "",
      sourceLanguageScrollTop: 0,
    });
    clearScopedSyncBadge("projects", render);
    failProjectsPageSync();
    showNoticeBadge(state.projectImport.error || "The file could not be imported.", render);
    render();
  }
}

export async function importProjectFile(render, selectedFile, options = {}) {
  if (state.projectImport.status === "importing") {
    return;
  }

  const projectId = state.projectImport.projectId;
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  const targetProject =
    state.projects.find((project) => project.id === projectId) ??
    state.deletedProjects.find((project) => project.id === projectId);
  if (!Number.isFinite(selectedTeam?.installationId) || !targetProject) {
    showNoticeBadge("Could not determine which project to add the file to.", render);
    return;
  }

  if (await ensureProjectNotTombstoned(render, selectedTeam, targetProject)) {
    return;
  }

  const sourceFileName = importFileName(selectedFile);
  const fileType = detectImportFileType(sourceFileName);
  if (!fileType) {
    const errorMessage = `Unsupported file type for ${sourceFileName}. XLSX and TXT are the supported import formats right now.`;
    setProjectImportError(render, errorMessage);
    return;
  }

  if (fileType === "txt" && !options.confirmedSourceLanguageCode) {
    state.projectImport = projectImportModalState({
      status: "selectingSourceLanguage",
      error: "",
      pendingFile: selectedFile,
      pendingFileName: sourceFileName,
      selectedSourceLanguageCode: "",
      sourceLanguageScrollTop: 0,
    });
    render();
    return;
  }

  await completeProjectImport(render, selectedFile, fileType, options);
}

export async function handleDroppedProjectImportFile(render, file) {
  if (!state.projectImport.isOpen || state.projectImport.status === "importing") {
    return;
  }

  await importProjectFile(render, file);
}

export async function handleDroppedProjectImportPath(render, path) {
  const normalizedPath = typeof path === "string" ? path.trim() : "";
  if (!normalizedPath || !state.projectImport.isOpen || state.projectImport.status === "importing") {
    return;
  }

  try {
    const file = await invoke("read_local_dropped_file", { path: normalizedPath });
    await importProjectFile(render, {
      name: typeof file?.name === "string" ? file.name : "",
      type: typeof file?.mimeType === "string" ? file.mimeType : "",
      dataBase64: typeof file?.dataBase64 === "string" ? file.dataBase64 : "",
    });
  } catch (error) {
    setProjectImportError(render, error instanceof Error ? error.message : String(error));
  }
}
