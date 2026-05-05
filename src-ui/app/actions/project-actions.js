import { state } from "../state.js";
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
  cancelChapterPermanentDeletion,
  cancelChapterRename,
  confirmChapterPermanentDeletion,
  deleteChapter,
  openChapterPermanentDeletion,
  openChapterRename,
  restoreChapter,
  submitChapterRename,
  toggleDeletedFiles,
} from "../project-chapter-flow.js";
import {
  addFilesToProject,
  cancelProjectImportModal,
  closeProjectImportUploadError,
  continueProjectImportText,
  selectProjectImportFile,
  selectProjectImportSourceLanguage,
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

export function createProjectActions(render) {
  const exactActions = {
    "open-new-project": () => createProjectForSelectedTeam(render),
    "cancel-project-creation": () => cancelProjectCreation(render),
    "cancel-project-permanent-deletion": () => cancelProjectPermanentDeletion(render),
    "cancel-project-rename": () => cancelProjectRename(render),
    "cancel-chapter-permanent-deletion": () => cancelChapterPermanentDeletion(render),
    "cancel-chapter-rename": () => cancelChapterRename(render),
    "clear-project-search": () => clearProjectSearch(render),
    "cancel-project-import": () => cancelProjectImportModal(render),
    "cancel-project-export": () => cancelProjectExport(render),
    "cancel-project-add-translation": () => cancelProjectAddTranslation(render),
    "close-project-export-unsupported": () => closeProjectExportUnsupported(render),
    "close-project-import-upload-error": () => closeProjectImportUploadError(render),
    "continue-project-import-text": () => continueProjectImportText(render),
    "select-project-import-file": () => selectProjectImportFile(render),
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
