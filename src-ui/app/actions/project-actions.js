import { state } from "../state.js";
import { canMutateProjectFiles } from "../resource-capabilities.js";
import { showNoticeBadge } from "../status-feedback.js";
import {
  clearProjectSearch,
  loadMoreProjectSearchResults,
  openProjectSearchResult,
} from "../project-search-flow.js";
import {
  cancelProjectCreation,
  cancelProjectPermanentDeletion,
  cancelProjectRename,
  confirmProjectPermanentDeletion,
  createProjectForSelectedTeam,
  deleteProject,
  openProjectRename,
  overwriteConflictedProjectRepos,
  permanentlyDeleteProject,
  repairProjectRepoBinding,
  rebuildProjectLocalRepo,
  restoreProject,
  submitProjectCreation,
  submitProjectRename,
  toggleDeletedProjects,
} from "../project-flow.js";
import {
  cancelProjectClearDeletedFiles,
  cancelChapterPermanentDeletion,
  cancelChapterRename,
  confirmProjectClearDeletedFiles,
  confirmChapterPermanentDeletion,
  deleteChapter,
  openProjectClearDeletedFiles,
  openChapterPermanentDeletion,
  openChapterRename,
  restoreChapter,
  submitChapterRename,
  toggleDeletedFiles,
} from "../project-chapter-flow.js";
import {
  addFilesToProject,
  cancelProjectImportModal,
  closeProjectImportLinkError,
  closeProjectImportUploadError,
  continueProjectImportText,
  retryProjectImportLink,
  selectProjectImportInputMode,
  selectProjectImportFile,
  selectProjectImportSourceLanguage,
  submitProjectImportLink,
  submitProjectImportPastedText,
} from "../project-import-flow.js";
import {
  cancelProjectAddTranslation,
  continueProjectAddTranslationAfterMismatch,
  continueProjectAddTranslationLanguage,
  continueProjectAddTranslationWithExistingText,
  openProjectAddTranslation,
  selectProjectAddTranslationLanguage,
  submitProjectAddTranslationPaste,
} from "../project-add-translation-flow.js";
import {
  cancelProjectExport,
  closeProjectExportUnsupported,
  openProjectExport,
  submitProjectExport,
} from "../project-export-flow.js";
import { actionSuffix, runWithImmediateLoading } from "../action-helpers.js";

const READ_ONLY_PROJECT_WRITE_ACTIONS = new Set([
  "open-new-project",
  "submit-project-import-link",
  "submit-project-import-pasted-text",
  "submit-project-add-translation-paste",
  "continue-project-add-translation-language",
  "continue-project-add-translation-existing",
  "continue-project-add-translation-mismatch",
  "overwrite-conflicted-project-repos",
  "submit-project-creation",
  "confirm-project-permanent-deletion",
  "confirm-chapter-permanent-deletion",
  "confirm-clear-deleted-files",
  "submit-project-rename",
  "submit-chapter-rename",
]);

const READ_ONLY_PROJECT_WRITE_PREFIXES = [
  "delete-project:",
  "add-project-files:",
  "add-translation-to-file:",
  "select-project-add-translation-language:",
  "select-project-import-source-language:",
  "rename-project:",
  "rename-file:",
  "delete-file:",
  "restore-file:",
  "delete-deleted-file:",
  "clear-deleted-files:",
  "repair-project:",
  "rebuild-project-repo:",
  "restore-project:",
  "delete-deleted-project:",
];

function selectedTeam() {
  return state.teams.find((team) => team.id === state.selectedTeamId) ?? null;
}

function blockReadOnlyProjectWrite(action, render) {
  if (canMutateProjectFiles(selectedTeam())) {
    return false;
  }
  const blocked =
    READ_ONLY_PROJECT_WRITE_ACTIONS.has(action)
    || READ_ONLY_PROJECT_WRITE_PREFIXES.some((prefix) => action.startsWith(prefix));
  if (!blocked) {
    return false;
  }
  showNoticeBadge("Read-only users cannot modify project files.", render, 2600);
  return true;
}

export function createProjectActions(render) {
  const exactActions = {
    "open-new-project": () => createProjectForSelectedTeam(render),
    "cancel-project-creation": () => cancelProjectCreation(render),
    "cancel-project-permanent-deletion": () => cancelProjectPermanentDeletion(render),
    "cancel-clear-deleted-files": () => cancelProjectClearDeletedFiles(render),
    "cancel-project-rename": () => cancelProjectRename(render),
    "cancel-chapter-permanent-deletion": () => cancelChapterPermanentDeletion(render),
    "cancel-chapter-rename": () => cancelChapterRename(render),
    "clear-project-search": () => clearProjectSearch(render),
    "cancel-project-import": () => cancelProjectImportModal(render),
    "cancel-project-export": () => cancelProjectExport(render),
    "cancel-project-add-translation": () => cancelProjectAddTranslation(render),
    "close-project-import-link-error": () => closeProjectImportLinkError(render),
    "close-project-export-unsupported": () => closeProjectExportUnsupported(render),
    "close-project-import-upload-error": () => closeProjectImportUploadError(render),
    "continue-project-import-text": () => continueProjectImportText(render),
    "retry-project-import-link": () => retryProjectImportLink(render),
    "select-project-import-file": () => selectProjectImportFile(render),
    "submit-project-import-link": () => submitProjectImportLink(render),
    "submit-project-import-pasted-text": () => submitProjectImportPastedText(render),
    "submit-project-add-translation-paste": () => submitProjectAddTranslationPaste(render),
    "continue-project-add-translation-language": () => continueProjectAddTranslationLanguage(render),
    "continue-project-add-translation-existing": () => continueProjectAddTranslationWithExistingText(render),
    "continue-project-add-translation-mismatch": () => continueProjectAddTranslationAfterMismatch(render),
    "load-more-project-search-results": () => loadMoreProjectSearchResults(render),
    "overwrite-conflicted-project-repos": () => overwriteConflictedProjectRepos(render),
    "toggle-deleted-projects": () => toggleDeletedProjects(render),
  };

  const prefixHandlers = [
    {
      prefix: "select-project-import-input-mode:",
      handler: (mode) => selectProjectImportInputMode(render, mode),
    },
    {
      prefix: "open-project-search-result:",
      handler: async (resultId) => openProjectSearchResult(render, resultId),
    },
    {
      prefix: "toggle-project:",
      handler: (projectId) => {
        if (state.expandedProjects.has(projectId)) {
          state.expandedProjects.delete(projectId);
        } else {
          state.expandedProjects.add(projectId);
        }
        render();
      },
    },
    {
      prefix: "toggle-deleted-files:",
      handler: (projectId) => toggleDeletedFiles(render, projectId),
    },
    {
      prefix: "delete-project:",
      handler: async (projectId, event) =>
        runWithImmediateLoading(event, "Deleting...", () => deleteProject(render, projectId)),
    },
    {
      prefix: "add-project-files:",
      handler: async (projectId) => addFilesToProject(render, projectId),
    },
    {
      prefix: "export-file:",
      handler: (chapterId) => openProjectExport(render, chapterId),
    },
    {
      prefix: "add-translation-to-file:",
      handler: (chapterId) => openProjectAddTranslation(render, chapterId),
    },
    {
      prefix: "select-project-add-translation-language:",
      handler: (languageCode) => selectProjectAddTranslationLanguage(render, languageCode),
    },
    {
      prefix: "select-project-import-source-language:",
      handler: (languageCode) => selectProjectImportSourceLanguage(render, languageCode),
    },
    {
      prefix: "rename-project:",
      handler: (projectId) => openProjectRename(render, projectId),
    },
    {
      prefix: "rename-file:",
      handler: (chapterId) => openChapterRename(render, chapterId),
    },
    {
      prefix: "delete-file:",
      handler: async (chapterId, event) =>
        runWithImmediateLoading(event, "Deleting...", () => deleteChapter(render, chapterId)),
    },
    {
      prefix: "restore-file:",
      handler: async (chapterId, event) =>
        runWithImmediateLoading(event, "Restoring...", () => restoreChapter(render, chapterId)),
    },
    {
      prefix: "delete-deleted-file:",
      handler: (chapterId) => openChapterPermanentDeletion(render, chapterId),
    },
    {
      prefix: "clear-deleted-files:",
      handler: (projectId) => openProjectClearDeletedFiles(render, projectId),
    },
    {
      prefix: "repair-project:",
      handler: async (projectId, event) =>
        runWithImmediateLoading(event, "Repairing...", () => repairProjectRepoBinding(render, projectId)),
    },
    {
      prefix: "rebuild-project-repo:",
      handler: async (projectId, event) =>
        runWithImmediateLoading(event, "Rebuilding...", () => rebuildProjectLocalRepo(render, projectId)),
    },
    {
      prefix: "restore-project:",
      handler: async (projectId, event) =>
        runWithImmediateLoading(event, "Restoring...", () => restoreProject(render, projectId)),
    },
    {
      prefix: "delete-deleted-project:",
      handler: (projectId) => permanentlyDeleteProject(render, projectId),
    },
  ];

  return async function handleProjectAction(action, event) {
    if (blockReadOnlyProjectWrite(action, render)) {
      return true;
    }

    if (exactActions[action]) {
      await exactActions[action]();
      return true;
    }

    if (action === "submit-project-creation") {
      await runWithImmediateLoading(event, "Creating...", () => submitProjectCreation(render));
      return true;
    }
    if (action === "confirm-project-permanent-deletion") {
      await runWithImmediateLoading(event, "Deleting...", () =>
        confirmProjectPermanentDeletion(render),
      );
      return true;
    }
    if (action === "confirm-chapter-permanent-deletion") {
      await runWithImmediateLoading(event, "Deleting...", () =>
        confirmChapterPermanentDeletion(render),
      );
      return true;
    }
    if (action === "confirm-clear-deleted-files") {
      await runWithImmediateLoading(event, "Deleting...", () =>
        confirmProjectClearDeletedFiles(render),
      );
      return true;
    }
    if (action === "submit-project-rename") {
      await runWithImmediateLoading(event, "Saving...", () => submitProjectRename(render));
      return true;
    }
    if (action === "submit-project-export") {
      await submitProjectExport(render);
      return true;
    }
    if (action === "submit-chapter-rename") {
      await runWithImmediateLoading(event, "Saving...", () => submitChapterRename(render));
      return true;
    }

    for (const { prefix, handler } of prefixHandlers) {
      const value = actionSuffix(action, prefix);
      if (value !== null) {
        await handler(value, event);
        return true;
      }
    }

    return false;
  };
}
