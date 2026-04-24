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
  selectProjectImportFile,
} from "../project-import-flow.js";
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
    "select-project-import-file": () => selectProjectImportFile(render),
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
