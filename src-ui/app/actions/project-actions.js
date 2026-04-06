import { state } from "../state.js";
import {
  cancelProjectCreation,
  cancelProjectPermanentDeletion,
  cancelProjectRename,
  confirmProjectPermanentDeletion,
  createProjectForSelectedTeam,
  deleteProject,
  openProjectRename,
  permanentlyDeleteProject,
  restoreProject,
  submitProjectCreation,
  submitProjectRename,
  toggleDeletedProjects,
} from "../project-flow.js";
import { addFilesToProject } from "../project-import-flow.js";
import { actionSuffix, runWithImmediateLoading } from "../action-helpers.js";

export function createProjectActions(render) {
  const exactActions = {
    "open-new-project": () => createProjectForSelectedTeam(render),
    "cancel-project-creation": () => cancelProjectCreation(render),
    "cancel-project-permanent-deletion": () => cancelProjectPermanentDeletion(render),
    "cancel-project-rename": () => cancelProjectRename(render),
    "toggle-deleted-projects": () => toggleDeletedProjects(render),
  };

  const prefixHandlers = [
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
      prefix: "delete-project:",
      handler: async (projectId, event) =>
        runWithImmediateLoading(event, "Deleting...", () => deleteProject(render, projectId)),
    },
    {
      prefix: "add-project-files:",
      handler: async (projectId, event) =>
        runWithImmediateLoading(event, "Adding...", () => addFilesToProject(render, projectId)),
    },
    {
      prefix: "rename-project:",
      handler: (projectId) => openProjectRename(render, projectId),
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
    if (action === "submit-project-rename") {
      await runWithImmediateLoading(event, "Saving...", () => submitProjectRename(render));
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
