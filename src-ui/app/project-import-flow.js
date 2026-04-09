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
import { refreshProjectFilesFromDisk } from "./project-flow.js";
import { openLocalFilePicker } from "./local-file-picker.js";

function detectImportFileType(fileName) {
  const normalized = String(fileName || "").trim().toLowerCase();
  if (normalized.endsWith(".xlsx")) {
    return "xlsx";
  }
  return null;
}

function buildImportedFileEntry(result) {
  const selectedSourceLanguageCode = result.selectedSourceLanguageCode ?? result.languages?.[0]?.code ?? null;
  const selectedTargetLanguageCode =
    result.selectedTargetLanguageCode
    ?? result.languages?.find((language) => language.code !== selectedSourceLanguageCode)?.code
    ?? selectedSourceLanguageCode;
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

export async function addFilesToProject(render, projectId) {
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

  const selectedFile = await openLocalFilePicker({
    accept: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  if (!selectedFile) {
    return;
  }

  const fileType = detectImportFileType(selectedFile.name);
  if (!fileType) {
    const errorMessage = `Unsupported file type for ${selectedFile.name}. XLSX is the only supported import format right now.`;
    state.projectImport = {
      status: "error",
      error: errorMessage,
      result: state.projectImport.result,
    };
    showNoticeBadge(errorMessage, render);
    render();
    return;
  }

  state.projectImport = {
    status: "importing",
    error: "",
    result: state.projectImport.result,
  };
  beginProjectsPageSync();
  showScopedSyncBadge("projects", "Adding file...", render);
  render();
  await waitForNextPaint();

  try {
    const bytes = Array.from(new Uint8Array(await selectedFile.arrayBuffer()));
    let result;
    if (fileType === "xlsx") {
      result = await invoke("import_xlsx_to_gtms", {
        input: {
          installationId: selectedTeam.installationId,
          repoName: targetProject.name,
          fileName: selectedFile.name,
          bytes,
        },
      });
    }

    state.projectImport = {
      status: "ready",
      error: "",
      result,
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
    state.projectImport = {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
      result: state.projectImport.result,
    };
    clearScopedSyncBadge("projects", render);
    failProjectsPageSync();
    showNoticeBadge(state.projectImport.error || "The file could not be imported.", render);
    render();
  }
}
