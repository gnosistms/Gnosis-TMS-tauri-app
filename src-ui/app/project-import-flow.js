import { invoke, listen, waitForNextPaint } from "./runtime.js";
import {
  beginProjectsPageSync,
  completeProjectsPageSync,
  failProjectsPageSync,
} from "./page-sync.js";
import { saveStoredProjectsForTeam } from "./project-cache.js";
import { state } from "./state.js";
import {
  showNoticeBadge,
} from "./status-feedback.js";
import { defaultGlossaryForTeam } from "./glossary-default-flow.js";
import { reconcileProjectRepoSyncStates } from "./project-repo-sync-flow.js";
import {
  applyProjectsQuerySnapshotToState,
  createProjectsQuerySnapshot,
  upsertProjectChapterInQueryData,
  upsertProjectChaptersInQueryData,
} from "./project-query.js";
import {
  projectKeys,
  queryClient,
} from "./query-client.js";
import {
  clearProjectsStatus,
  ensureProjectNotTombstoned,
  reconcileExpandedDeletedFiles,
  refreshProjectFilesFromDisk,
  showProjectsNotice,
  showProjectsStatus,
} from "./project-chapter-flow.js";
import {
  chapterImportIntentKey,
  projectRepoWriteScope,
  requestProjectWriteIntent,
} from "./project-write-coordinator.js";
import { enqueueRepoWrite } from "./repo-write-queue.js";
import { openLocalFilePathPicker, openLocalFilePicker } from "./local-file-picker.js";
import { enforceImportFileSizeLimit } from "./import-file-limit.js";
import { canManageProjects } from "./resource-capabilities.js";
import { normalizeSupportedLanguageCode } from "../lib/language-options.js";

export const PROJECT_IMPORT_ACCEPT =
  ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.txt,text/plain,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.html,.htm,text/html";

const SUPPORTED_PROJECT_IMPORT_FORMATS_LABEL = "XLSX, TXT, DOCX, and HTML";
const PROJECT_IMPORT_BATCH_PROGRESS_EVENT = "project-import-batch-progress";
const PROJECT_IMPORT_DIALOG_FILTERS = [
  {
    name: "Supported project files",
    extensions: ["xlsx", "txt", "docx", "html", "htm"],
  },
];

export function detectImportFileType(fileName) {
  const normalized = String(fileName || "").trim().toLowerCase();
  if (normalized.endsWith(".xlsx")) {
    return "xlsx";
  }
  if (normalized.endsWith(".txt")) {
    return "txt";
  }
  if (normalized.endsWith(".docx")) {
    return "docx";
  }
  if (normalized.endsWith(".html") || normalized.endsWith(".htm")) {
    return "html";
  }
  return null;
}

function importFileTypeNeedsSourceLanguage(fileType) {
  return fileType === "txt" || fileType === "docx" || fileType === "html";
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

function droppedPathFileName(path) {
  const normalizedPath = typeof path === "string" ? path.trim() : "";
  const name = normalizedPath.split(/[\\/]/).filter(Boolean).pop() ?? "";
  return name || "file";
}

function droppedPathImportFile(path) {
  const normalizedPath = typeof path === "string" ? path.trim() : "";
  return normalizedPath
    ? {
        name: droppedPathFileName(normalizedPath),
        droppedPath: normalizedPath,
        sourcePath: normalizedPath,
        sourceUrl: localPathToFileUrl(normalizedPath),
      }
    : null;
}

function droppedPathImportFileLike(value) {
  return value && typeof value === "object" && typeof value.droppedPath === "string";
}

function normalizeImportFileList(files) {
  if (!Array.isArray(files)) {
    return files ? [files] : [];
  }

  return files.filter(Boolean);
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

function encodeUtf8TextToBase64(value) {
  const bytes = new TextEncoder().encode(String(value ?? ""));
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  if (typeof globalThis.btoa === "function") {
    return globalThis.btoa(binary);
  }

  if (typeof Buffer === "function") {
    return Buffer.from(bytes).toString("base64");
  }

  throw new Error("Base64 encoding is unavailable.");
}

function localPathToFileUrl(path) {
  const normalizedPath = typeof path === "string" ? path.trim().replace(/\\/g, "/") : "";
  if (!normalizedPath.startsWith("/")) {
    return "";
  }

  return `file://${normalizedPath.split("/").map((part) => encodeURIComponent(part)).join("/")}`;
}

function linkImportErrorKind(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message.startsWith("PROJECT_IMPORT_LINK_ACCESS_DENIED:")) {
    return "accessDenied";
  }
  return "invalid";
}

async function importFileBytes(file) {
  if (droppedPathImportFileLike(file)) {
    const droppedFile = await invoke("read_local_dropped_file", { path: file.droppedPath });
    return importFileBytes({
      name: typeof droppedFile?.name === "string" ? droppedFile.name : file.name,
      type: typeof droppedFile?.mimeType === "string" ? droppedFile.mimeType : "",
      dataBase64: typeof droppedFile?.dataBase64 === "string" ? droppedFile.dataBase64 : "",
      sourcePath: file.sourcePath,
      sourceUrl: file.sourceUrl,
    });
  }

  if (readableImportFileLike(file)) {
    enforceImportFileSizeLimit(file.size, importFileName(file));
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

function normalizeProjectImportInputMode(value) {
  const mode = String(value ?? "").trim();
  return mode === "pasteLink" || mode === "pasteText" ? mode : "upload";
}

function importSummaryNoticeSuffix(result) {
  const summary = result?.importSummary;
  if (!summary || typeof summary !== "object") {
    return "";
  }

  const details = [];
  const flattenedListItems = Number(summary.flattenedListItems ?? 0);
  const flattenedTableRows = Number(summary.flattenedTableRows ?? 0);
  const importedFootnotes = Number(summary.importedFootnotes ?? 0);
  const unsupportedCounts =
    summary.unsupportedContentCounts && typeof summary.unsupportedContentCounts === "object"
      ? summary.unsupportedContentCounts
      : {};
  const unsupportedTotal = Object.values(unsupportedCounts)
    .reduce((sum, value) => sum + (Number(value) || 0), 0);

  if (flattenedListItems > 0) {
    details.push(`${flattenedListItems} list ${flattenedListItems === 1 ? "item" : "items"} flattened`);
  }
  if (flattenedTableRows > 0) {
    details.push(`${flattenedTableRows} table ${flattenedTableRows === 1 ? "row" : "rows"} flattened`);
  }
  if (importedFootnotes > 0) {
    details.push(`${importedFootnotes} ${importedFootnotes === 1 ? "footnote" : "footnotes"} preserved`);
  }
  if (unsupportedTotal > 0) {
    details.push(`${unsupportedTotal} unsupported ${unsupportedTotal === 1 ? "item" : "items"} omitted`);
  }

  return details.length > 0 ? ` ${details.join("; ")}.` : "";
}

function setProjectImportError(render, message) {
  state.projectImport = projectImportModalState({
    status: "error",
    error: message,
  });
  render();
}

function projectImportUsesUploadProgress() {
  return normalizeProjectImportInputMode(state.projectImport.inputMode) === "upload";
}

function resetProjectImportUploadProgress() {
  return {
    uploadProgress: null,
    uploadCancelRequested: false,
    batchId: "",
  };
}

function projectImportUploadProgress(total, current) {
  const normalizedTotal = Math.max(1, Number.parseInt(String(total ?? 1), 10) || 1);
  const normalizedCurrent = Math.min(
    normalizedTotal,
    Math.max(1, Number.parseInt(String(current ?? 1), 10) || 1),
  );
  return {
    current: normalizedCurrent,
    total: normalizedTotal,
  };
}

function setProjectImportUploadProgress(render, total, current) {
  state.projectImport = projectImportModalState({
    uploadProgress: projectImportUploadProgress(total, current),
  });
  render();
}

function createProjectImportBatchId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `project-import-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

function glossaryLinkFromGlossary(glossary) {
  if (!glossary?.id || !glossary?.repoName) {
    return null;
  }

  return {
    glossaryId: glossary.id,
    repoName: glossary.repoName,
  };
}

async function assignDefaultGlossaryToImportedFile(selectedTeam, targetProject, result) {
  const defaultGlossary = defaultGlossaryForTeam(selectedTeam);
  const linkedGlossary = glossaryLinkFromGlossary(defaultGlossary);
  if (!linkedGlossary) {
    return {
      linkedGlossary: null,
      error: null,
    };
  }

  try {
    await invoke("update_gtms_chapter_glossary_links", {
      input: {
        installationId: selectedTeam.installationId,
        projectId: targetProject.id,
        repoName: targetProject.name,
        chapterId: result.chapterId,
        glossary: linkedGlossary,
      },
    });
  } catch (error) {
    return {
      linkedGlossary: null,
      error,
    };
  }

  return {
    linkedGlossary,
    error: null,
  };
}

function projectImportDefaultGlossaryLink(selectedTeam) {
  return glossaryLinkFromGlossary(defaultGlossaryForTeam(selectedTeam));
}

function currentProjectsQueryData(team, projectId) {
  const teamId = team?.id ?? null;
  const queryData = queryClient.getQueryData(projectKeys.byTeam(teamId));
  const queryProjects = [
    ...(Array.isArray(queryData?.snapshot?.items) ? queryData.snapshot.items : []),
    ...(Array.isArray(queryData?.snapshot?.deletedItems) ? queryData.snapshot.deletedItems : []),
  ];
  if (queryProjects.some((project) => project?.id === projectId)) {
    return queryData;
  }

  return createProjectsQuerySnapshot({
    items: state.projects,
    deletedItems: state.deletedProjects,
    repoSyncByProjectId: state.projectRepoSyncByProjectId,
    glossaries: state.glossaries,
    pendingChapterMutations: state.pendingChapterMutations,
    discovery: state.projectDiscovery,
  });
}

async function applyImportedFileToProject(team, targetProject, result, linkedGlossary = null) {
  const projectId = typeof targetProject === "string" ? targetProject : targetProject?.id;
  const importedFile = {
    ...buildImportedFileEntry(result),
    linkedGlossary,
  };
  const teamId = team?.id ?? null;
  const queryKey = projectKeys.byTeam(teamId);
  await queryClient.cancelQueries({ queryKey });
  requestProjectWriteIntent({
    key: chapterImportIntentKey(projectId, importedFile.id),
    scope: projectRepoWriteScope(team, targetProject),
    teamId,
    projectId,
    chapterId: importedFile.id,
    type: "chapterImport",
    value: {
      chapter: importedFile,
    },
  }, {
    run: async () => {},
  });

  const nextQueryData = upsertProjectChapterInQueryData(
    currentProjectsQueryData(team, projectId),
    projectId,
    importedFile,
  );
  queryClient.setQueryData(queryKey, nextQueryData);
  applyProjectsQuerySnapshotToState(nextQueryData, {
    teamId,
    isFetching: state.projectsPage?.isRefreshing === true,
    reconcileExpandedDeletedFiles,
  });
  state.expandedProjects.add(projectId);
  saveStoredProjectsForTeam(team, {
    projects: state.projects,
    deletedProjects: state.deletedProjects,
  });
}

async function applyImportedFilesToProject(team, targetProject, results, linkedGlossary = null) {
  const projectId = typeof targetProject === "string" ? targetProject : targetProject?.id;
  const importedFiles = (Array.isArray(results) ? results : [])
    .filter(Boolean)
    .map((result) => ({
      ...buildImportedFileEntry(result),
      linkedGlossary,
    }));
  if (importedFiles.length === 0) {
    return;
  }

  const teamId = team?.id ?? null;
  const queryKey = projectKeys.byTeam(teamId);
  await queryClient.cancelQueries({ queryKey });
  for (const importedFile of importedFiles) {
    requestProjectWriteIntent({
      key: chapterImportIntentKey(projectId, importedFile.id),
      scope: projectRepoWriteScope(team, targetProject),
      teamId,
      projectId,
      chapterId: importedFile.id,
      type: "chapterImport",
      value: {
        chapter: importedFile,
      },
    }, {
      run: async () => {},
    });
  }

  const nextQueryData = upsertProjectChaptersInQueryData(
    currentProjectsQueryData(team, projectId),
    projectId,
    importedFiles,
  );
  queryClient.setQueryData(queryKey, nextQueryData);
  applyProjectsQuerySnapshotToState(nextQueryData, {
    teamId,
    isFetching: state.projectsPage?.isRefreshing === true,
    reconcileExpandedDeletedFiles,
  });
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

  if (!canManageProjects(selectedTeam)) {
    showNoticeBadge("You do not have permission to add files in this team.", render);
    return;
  }

  state.projectImport = {
    ...state.projectImport,
    isOpen: true,
    projectId: targetProject.id,
    projectTitle: targetProject.title ?? targetProject.name ?? "",
    inputMode: "upload",
    linkUrl: "",
    linkErrorModal: null,
    pastedText: "",
    status: "idle",
    error: "",
    failedFileNames: [],
    pendingFile: null,
    pendingFiles: [],
    pendingFileName: "",
    isBatch: false,
    ...resetProjectImportUploadProgress(),
    selectedSourceLanguageCode: "",
    sourceLanguageScrollTop: 0,
  };
  render();
}

export function cancelProjectImportModal(render) {
  if (state.projectImport.status === "importing") {
    const batchId = typeof state.projectImport.batchId === "string" ? state.projectImport.batchId.trim() : "";
    if (batchId) {
      void invoke("cancel_project_import_batch", { batchId }).catch(() => {});
    }
    state.projectImport = projectImportModalState({
      uploadCancelRequested: true,
    });
    render();
    return;
  }

  state.projectImport = {
    ...state.projectImport,
    isOpen: false,
    projectId: null,
    projectTitle: "",
    inputMode: "upload",
    linkUrl: "",
    linkErrorModal: null,
    pastedText: "",
    status: "idle",
    error: "",
    failedFileNames: [],
    pendingFile: null,
    pendingFiles: [],
    pendingFileName: "",
    isBatch: false,
    ...resetProjectImportUploadProgress(),
    selectedSourceLanguageCode: "",
    sourceLanguageScrollTop: 0,
  };
  render();
}

export function closeProjectImportUploadError(render) {
  state.projectImport = projectImportModalState({
    failedFileNames: [],
  });
  render();
}

export function selectProjectImportInputMode(render, mode) {
  if (state.projectImport.status === "importing" || state.projectImport.status === "resolvingLink" || !state.projectImport.isOpen) {
    return;
  }

  state.projectImport = projectImportModalState({
    inputMode: normalizeProjectImportInputMode(mode),
    error: "",
    linkErrorModal: null,
    ...(normalizeProjectImportInputMode(mode) === "pasteLink" ? {} : { linkUrl: "" }),
    ...(normalizeProjectImportInputMode(mode) === "pasteText" ? {} : { pastedText: "" }),
  });
  render();
}

export function updateProjectImportLinkUrl(render, value) {
  if (!state.projectImport.isOpen || state.projectImport.status === "importing" || state.projectImport.status === "resolvingLink") {
    return;
  }

  state.projectImport = projectImportModalState({
    linkUrl: typeof value === "string" ? value : "",
    error: "",
    linkErrorModal: null,
  });
  render?.();
}

export function updateProjectImportPastedText(render, value) {
  if (!state.projectImport.isOpen || state.projectImport.status === "importing" || state.projectImport.status === "resolvingLink") {
    return;
  }

  state.projectImport = projectImportModalState({
    pastedText: typeof value === "string" ? value : "",
    error: "",
    linkErrorModal: null,
  });
  render?.();
}

export function closeProjectImportLinkError(render) {
  state.projectImport = projectImportModalState({
    status: "idle",
    linkErrorModal: null,
  });
  render();
}

export async function retryProjectImportLink(render) {
  state.projectImport = projectImportModalState({
    linkErrorModal: null,
  });
  await submitProjectImportLink(render);
}

export async function submitProjectImportLink(render) {
  if (!state.projectImport.isOpen || state.projectImport.status === "importing" || state.projectImport.status === "resolvingLink") {
    return;
  }

  const url = String(state.projectImport.linkUrl ?? "").trim();
  if (!url) {
    return;
  }

  let parsedUrl = null;
  try {
    parsedUrl = new URL(url);
  } catch {
    state.projectImport = projectImportModalState({
      status: "idle",
      linkErrorModal: "invalid",
      error: "",
    });
    render();
    return;
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    state.projectImport = projectImportModalState({
      status: "idle",
      linkErrorModal: "invalid",
      error: "",
    });
    render();
    return;
  }

  state.projectImport = projectImportModalState({
    status: "resolvingLink",
    error: "",
    linkErrorModal: null,
  });
  render();
  await waitForNextPaint();

  try {
    const resolved = await invoke("resolve_project_import_link", {
      input: {
        url,
      },
    });
    const fileName = typeof resolved?.fileName === "string" && resolved.fileName.trim()
      ? resolved.fileName.trim()
      : "linked-file";
    const dataBase64 = typeof resolved?.dataBase64 === "string" ? resolved.dataBase64 : "";
    const sourceUrl = typeof resolved?.sourceUrl === "string" ? resolved.sourceUrl : url;
    state.projectImport = projectImportModalState({
      status: "idle",
      error: "",
      linkErrorModal: null,
    });
    await importProjectFile(render, {
      name: fileName,
      dataBase64,
      sourceUrl,
    });
  } catch (error) {
    state.projectImport = projectImportModalState({
      status: "idle",
      error: "",
      linkErrorModal: linkImportErrorKind(error),
    });
    render();
  }
}

export async function submitProjectImportPastedText(render) {
  if (!state.projectImport.isOpen || state.projectImport.status === "importing" || state.projectImport.status === "resolvingLink") {
    return;
  }

  const pastedText = String(state.projectImport.pastedText ?? "");
  if (!pastedText.trim()) {
    state.projectImport = projectImportModalState({
      status: "idle",
      error: "Paste text before continuing.",
      linkErrorModal: null,
    });
    render();
    return;
  }

  await importProjectFile(render, {
    name: "Pasted text.txt",
    dataBase64: encodeUtf8TextToBase64(pastedText),
  });
}

export async function selectProjectImportFile(render) {
  if (state.projectImport.status === "importing" || !state.projectImport.isOpen) {
    return;
  }

  const selectedPaths = await openLocalFilePathPicker({
    multiple: true,
    filters: PROJECT_IMPORT_DIALOG_FILTERS,
  });
  const selectedFiles = selectedPaths === null
    ? await openLocalFilePicker({
        accept: PROJECT_IMPORT_ACCEPT,
        multiple: true,
      })
    : selectedPaths.map(droppedPathImportFile).filter(Boolean);
  const files = normalizeImportFileList(selectedFiles);
  if (files.length === 0) {
    return;
  }

  await importProjectFiles(render, files);
}

export async function addFilesToProject(render, projectId) {
  openProjectImportModal(render, projectId);
}

export function selectProjectImportSourceLanguage(render, languageCode) {
  if (state.projectImport.status !== "selectingSourceLanguage") {
    return;
  }

  const code = normalizeSupportedLanguageCode(languageCode);
  const previousCode = normalizeSupportedLanguageCode(state.projectImport.selectedSourceLanguageCode);
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
  if (state.projectImport.status !== "selectingSourceLanguage") {
    return;
  }

  const sourceLanguageCode = normalizeSupportedLanguageCode(state.projectImport.selectedSourceLanguageCode);
  if (!sourceLanguageCode) {
    return;
  }

  if (state.projectImport.isBatch === true) {
    const pendingFiles = normalizeImportFileList(state.projectImport.pendingFiles);
    if (pendingFiles.length === 0) {
      return;
    }

    await importProjectFiles(render, pendingFiles, {
      confirmedSourceLanguageCode: sourceLanguageCode,
    });
    return;
  }

  if (!state.projectImport.pendingFile) {
    return;
  }

  await importProjectFile(render, state.projectImport.pendingFile, {
    confirmedSourceLanguageCode: sourceLanguageCode,
  });
}

async function importProjectFileResult(selectedTeam, targetProject, selectedFile, fileType, options = {}) {
  const sourceFileName = importFileName(selectedFile);
  const bytes = await importFileBytes(selectedFile);

  if (fileType === "xlsx") {
    return invoke("import_xlsx_to_gtms", {
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
    return invoke("import_txt_to_gtms", {
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

  if (fileType === "docx") {
    return invoke("import_docx_to_gtms", {
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

  if (fileType === "html") {
    return invoke("import_html_to_gtms", {
      input: {
        installationId: selectedTeam.installationId,
        projectId: targetProject.id,
        repoName: targetProject.name,
        fileName: sourceFileName,
        bytes,
        sourceLanguageCode: options.confirmedSourceLanguageCode,
        sourceUrl: typeof selectedFile?.sourceUrl === "string" ? selectedFile.sourceUrl : "",
        sourcePath: typeof selectedFile?.sourcePath === "string" ? selectedFile.sourcePath : null,
      },
    });
  }

  throw new Error(`Unsupported file type for ${sourceFileName}.`);
}

async function buildProjectImportBatchFiles(files, sourceLanguageCode) {
  const batchFiles = [];
  const failedFileNames = [];

  for (const file of normalizeImportFileList(files)) {
    const sourceFileName = importFileName(file);
    const fileType = detectImportFileType(sourceFileName);
    if (!fileType || (importFileTypeNeedsSourceLanguage(fileType) && !sourceLanguageCode)) {
      failedFileNames.push(sourceFileName);
      continue;
    }

    const payload = {
      fileName: sourceFileName,
      fileType,
      ...(importFileTypeNeedsSourceLanguage(fileType) ? { sourceLanguageCode } : {}),
      ...(typeof file?.sourceUrl === "string" ? { sourceUrl: file.sourceUrl } : {}),
      ...(typeof file?.sourcePath === "string" ? { sourcePath: file.sourcePath } : {}),
    };

    if (!payload.sourcePath) {
      payload.bytes = await importFileBytes(file);
    }
    batchFiles.push(payload);
  }

  return { batchFiles, failedFileNames };
}

function failedFileNamesFromBatchResult(result) {
  const names = Array.isArray(result?.failedFileNames)
    ? result.failedFileNames
    : Array.isArray(result?.failedFiles)
      ? result.failedFiles.map((failure) => failure?.fileName)
      : [];
  return names
    .map((fileName) => String(fileName ?? "").trim())
    .filter(Boolean);
}

async function importProjectFilesBatch(render, selectedTeam, targetProject, batchFiles, batchId, linkedGlossary) {
  let unlisten = null;
  if (typeof listen === "function") {
    unlisten = await listen(PROJECT_IMPORT_BATCH_PROGRESS_EVENT, (event) => {
      const payload = event?.payload ?? {};
      if (payload.batchId !== batchId || state.projectImport.status !== "importing") {
        return;
      }
      setProjectImportUploadProgress(render, payload.total, payload.current);
    }).catch(() => null);
  }

  try {
    return await invoke("import_project_files_to_gtms", {
      input: {
        batchId,
        installationId: selectedTeam.installationId,
        projectId: targetProject.id,
        repoName: targetProject.name,
        files: batchFiles,
        defaultGlossary: linkedGlossary,
      },
    });
  } finally {
    if (typeof unlisten === "function") {
      unlisten();
    }
  }
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
  const usesUploadProgress = projectImportUsesUploadProgress();
  state.projectImport = projectImportModalState({
    status: "importing",
    error: "",
    ...(usesUploadProgress
      ? {
          uploadProgress: projectImportUploadProgress(1, 1),
          uploadCancelRequested: false,
        }
      : resetProjectImportUploadProgress()),
  });
  beginProjectsPageSync();
  if (!usesUploadProgress) {
    showProjectsStatus(render, "Importing file...");
  }
  render();
  await waitForNextPaint();

  try {
    const { result, defaultAssignment } = await enqueueRepoWrite({
      scope: projectRepoWriteScope(selectedTeam, targetProject),
      kind: "projectImport",
      sourceScreen: "projects",
      errorTarget: {
        projectId: targetProject.id,
        kind: "projectImport",
      },
      run: async () => {
        const importedResult = await importProjectFileResult(
          selectedTeam,
          targetProject,
          selectedFile,
          fileType,
          options,
        );
        const importedDefaultAssignment = await assignDefaultGlossaryToImportedFile(
          selectedTeam,
          targetProject,
          importedResult,
        );
        return {
          result: importedResult,
          defaultAssignment: importedDefaultAssignment,
        };
      },
    });

    state.projectImport = {
      ...state.projectImport,
      isOpen: false,
      projectId: null,
      projectTitle: "",
      status: "ready",
      error: "",
      result,
      pastedText: "",
      pendingFile: null,
      pendingFiles: [],
      pendingFileName: "",
      failedFileNames: [],
      isBatch: false,
      ...resetProjectImportUploadProgress(),
      selectedSourceLanguageCode: "",
      sourceLanguageScrollTop: 0,
    };
    await applyImportedFileToProject(selectedTeam, targetProject, result, defaultAssignment.linkedGlossary);
    render();
    await waitForNextPaint();
    showProjectsStatus(render, "Syncing project repo...");
    await reconcileProjectRepoSyncStates(render, selectedTeam, [targetProject], {
      clearStatusOnComplete: false,
    });
    showProjectsStatus(render, "Refreshing file list...");
    await refreshProjectFilesFromDisk(render, selectedTeam, [targetProject]);
    await completeProjectsPageSync(render);
    clearProjectsStatus(render);
    showProjectsNotice(
      render,
      `Imported ${result.unitCount} rows from ${result.sourceFileName} into ${result.projectTitle}.${importSummaryNoticeSuffix(result)}${
        defaultAssignment.error ? " Default glossary could not be assigned." : ""
      }`,
    );
  } catch (error) {
    state.projectImport = projectImportModalState({
      status: "error",
      error: error instanceof Error ? error.message : String(error),
      pendingFile: null,
      pendingFiles: [],
      pendingFileName: "",
      failedFileNames: [],
      isBatch: false,
      ...resetProjectImportUploadProgress(),
      selectedSourceLanguageCode: "",
      sourceLanguageScrollTop: 0,
    });
    clearProjectsStatus(render);
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
    const errorMessage = `Unsupported file type for ${sourceFileName}. ${SUPPORTED_PROJECT_IMPORT_FORMATS_LABEL} are the supported import formats right now.`;
    setProjectImportError(render, errorMessage);
    return;
  }

  if (importFileTypeNeedsSourceLanguage(fileType) && !options.confirmedSourceLanguageCode) {
    state.projectImport = projectImportModalState({
      status: "selectingSourceLanguage",
      error: "",
      pendingFile: selectedFile,
      pendingFileName: sourceFileName,
      selectedSourceLanguageCode: "",
      sourceLanguageScrollTop: 0,
      ...resetProjectImportUploadProgress(),
    });
    render();
    return;
  }

  await completeProjectImport(render, selectedFile, fileType, options);
}

export async function importProjectFiles(render, selectedFiles, options = {}) {
  if (state.projectImport.status === "importing") {
    return;
  }

  const files = normalizeImportFileList(selectedFiles);
  if (files.length === 0) {
    return;
  }

  if (files.length === 1) {
    await importProjectFile(render, files[0], options);
    return;
  }

  const projectId = state.projectImport.projectId;
  const selectedTeam = state.teams.find((team) => team.id === state.selectedTeamId);
  const targetProject =
    state.projects.find((project) => project.id === projectId) ??
    state.deletedProjects.find((project) => project.id === projectId);
  if (!Number.isFinite(selectedTeam?.installationId) || !targetProject) {
    showNoticeBadge("Could not determine which project to add the files to.", render);
    return;
  }

  if (await ensureProjectNotTombstoned(render, selectedTeam, targetProject)) {
    return;
  }

  const needsSourceLanguage = files.some((file) =>
    importFileTypeNeedsSourceLanguage(detectImportFileType(importFileName(file)))
  );
  if (needsSourceLanguage && !options.confirmedSourceLanguageCode) {
    state.projectImport = projectImportModalState({
      status: "selectingSourceLanguage",
      error: "",
      pendingFile: null,
      pendingFiles: files,
      pendingFileName: "",
      failedFileNames: [],
      isBatch: true,
      ...resetProjectImportUploadProgress(),
      selectedSourceLanguageCode: "",
      sourceLanguageScrollTop: 0,
    });
    render();
    return;
  }

  const usesUploadProgress = projectImportUsesUploadProgress();
  const batchId = createProjectImportBatchId();
  const linkedGlossary = projectImportDefaultGlossaryLink(selectedTeam);

  state.projectImport = projectImportModalState({
    status: "importing",
    error: "",
    pendingFile: null,
    pendingFiles: files,
    pendingFileName: "",
    failedFileNames: [],
    isBatch: true,
    ...(usesUploadProgress
      ? {
          uploadProgress: projectImportUploadProgress(files.length, 1),
          uploadCancelRequested: false,
        }
      : resetProjectImportUploadProgress()),
    batchId,
  });
  beginProjectsPageSync();
  if (!usesUploadProgress) {
    showProjectsStatus(render, "Importing files...");
  }
  render();
  await waitForNextPaint();

  let importedResults = [];
  let failedFileNames = [];
  let wasCanceled = false;
  try {
    const batchPayload = await buildProjectImportBatchFiles(files, options.confirmedSourceLanguageCode);
    failedFileNames = batchPayload.failedFileNames;
    if (state.projectImport.uploadCancelRequested === true) {
      wasCanceled = true;
    } else if (batchPayload.batchFiles.length > 0) {
      const batchResult = await enqueueRepoWrite({
        scope: projectRepoWriteScope(selectedTeam, targetProject),
        kind: "projectImportBatch",
        sourceScreen: "projects",
        errorTarget: {
          projectId: targetProject.id,
          kind: "projectImportBatch",
        },
        run: () => importProjectFilesBatch(
          render,
          selectedTeam,
          targetProject,
          batchPayload.batchFiles,
          batchId,
          linkedGlossary,
        ),
      });
      importedResults = Array.isArray(batchResult?.imported) ? batchResult.imported : [];
      failedFileNames = [
        ...failedFileNames,
        ...failedFileNamesFromBatchResult(batchResult),
      ];
      wasCanceled = batchResult?.canceled === true || state.projectImport.uploadCancelRequested === true;
      await applyImportedFilesToProject(selectedTeam, targetProject, importedResults, linkedGlossary);
    }
  } catch (error) {
    state.projectImport = projectImportModalState({
      status: "error",
      error: error instanceof Error ? error.message : String(error),
      pendingFile: null,
      pendingFiles: [],
      pendingFileName: "",
      failedFileNames: [],
      isBatch: false,
      ...resetProjectImportUploadProgress(),
      selectedSourceLanguageCode: "",
      sourceLanguageScrollTop: 0,
    });
    clearProjectsStatus(render);
    failProjectsPageSync();
    showNoticeBadge(state.projectImport.error || "The files could not be imported.", render);
    render();
    return;
  }

  state.projectImport = {
    ...state.projectImport,
    isOpen: false,
    projectId: null,
    projectTitle: "",
    status: importedResults.length > 0 ? "ready" : "error",
    error: "",
    result: importedResults[importedResults.length - 1] ?? null,
    pastedText: "",
    pendingFile: null,
    pendingFiles: [],
    pendingFileName: "",
    failedFileNames,
    isBatch: false,
    ...resetProjectImportUploadProgress(),
    selectedSourceLanguageCode: "",
    sourceLanguageScrollTop: 0,
  };
  render();

  if (importedResults.length > 0) {
    await waitForNextPaint();
    showProjectsStatus(render, "Syncing project repo...");
    await reconcileProjectRepoSyncStates(render, selectedTeam, [targetProject], {
      clearStatusOnComplete: false,
    });
    showProjectsStatus(render, "Refreshing file list...");
    await refreshProjectFilesFromDisk(render, selectedTeam, [targetProject]);
    await completeProjectsPageSync(render);
    clearProjectsStatus(render);
    showProjectsNotice(
      render,
      wasCanceled
        ? `Import cancelled after importing ${importedResults.length} of ${files.length} ${files.length === 1 ? "file" : "files"}.`
        : failedFileNames.length > 0
        ? `Imported ${importedResults.length} ${importedResults.length === 1 ? "file" : "files"}. ${failedFileNames.length} ${failedFileNames.length === 1 ? "file" : "files"} failed.`
        : `Imported ${importedResults.length} ${importedResults.length === 1 ? "file" : "files"} into ${targetProject.title ?? targetProject.name}`,
    );
    return;
  }

  clearProjectsStatus(render);
  failProjectsPageSync();
  showNoticeBadge(wasCanceled ? "Import cancelled. No files were imported." : "No files were imported.", render);
  render();
}

export async function handleDroppedProjectImportFiles(render, files) {
  if (!state.projectImport.isOpen || state.projectImport.status === "importing") {
    return;
  }

  await importProjectFiles(render, files);
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
      sourcePath: normalizedPath,
      sourceUrl: localPathToFileUrl(normalizedPath),
    });
  } catch (error) {
    setProjectImportError(render, error instanceof Error ? error.message : String(error));
  }
}

export async function handleDroppedProjectImportPaths(render, paths) {
  if (!state.projectImport.isOpen || state.projectImport.status === "importing") {
    return;
  }

  const files = Array.isArray(paths)
    ? paths.map(droppedPathImportFile).filter(Boolean)
    : [];
  if (files.length === 0) {
    return;
  }

  if (files.length === 1) {
    await handleDroppedProjectImportPath(render, files[0].droppedPath);
    return;
  }

  await importProjectFiles(render, files);
}
