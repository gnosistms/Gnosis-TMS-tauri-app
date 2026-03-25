import { openExternalUrl, waitForNextPaint } from "./runtime.js";
import { clearStoredAuthSession } from "./auth-storage.js";
import { setImmediateLoadingButton } from "../lib/ui.js";
import {
  resetSessionState,
  resetTeamSetup,
  state,
} from "./state.js";
import { startGithubLogin } from "./auth-flow.js";
import {
  beginGithubAppInstall,
  beginTeamOrgSetup,
  cancelTeamRename,
  finishTeamSetup,
  loadUserTeams,
  openTeamSetup,
  openTeamRename,
  submitTeamRename,
  updateTeamRenameName,
} from "./team-setup-flow.js";
import {
  cancelProjectCreation,
  cancelProjectDeletion,
  cancelProjectPermanentDeletion,
  cancelProjectRename,
  confirmProjectDeletion,
  confirmProjectPermanentDeletion,
  createProjectForSelectedTeam,
  deleteProject,
  loadTeamProjects,
  openProjectRename,
  permanentlyDeleteProject,
  submitProjectCreation,
  submitProjectRename,
  toggleDeletedProjects,
  updateProjectCreationName,
  updateProjectPermanentDeletionConfirmation,
  updateProjectRenameName,
} from "./project-flow.js";
import { loadTeamUsers } from "./user-flow.js";

export function registerAppEvents(render) {
  document.addEventListener("input", (event) => {
    const projectNameInput = event.target.closest("[data-project-name-input]");
    if (projectNameInput) {
      updateProjectCreationName(projectNameInput.value);
    }

    const permanentDeleteInput = event.target.closest("[data-project-permanent-delete-input]");
    if (permanentDeleteInput) {
      updateProjectPermanentDeletionConfirmation(permanentDeleteInput.value);
      const deleteButton = document.querySelector("[data-project-permanent-delete-button]");
      if (deleteButton) {
        deleteButton.disabled =
          permanentDeleteInput.value !== state.projectPermanentDeletion.projectName;
      }
    }

    const teamRenameInput = event.target.closest("[data-team-rename-input]");
    if (teamRenameInput) {
      updateTeamRenameName(teamRenameInput.value);
    }

    const projectRenameInput = event.target.closest("[data-project-rename-input]");
    if (projectRenameInput) {
      updateProjectRenameName(projectRenameInput.value);
    }
  });

  document.addEventListener("click", async (event) => {
    const navTarget = event.target.closest("[data-nav-target]")?.dataset.navTarget;
    if (navTarget) {
      if (navTarget === "start") {
        void clearStoredAuthSession();
        resetSessionState();
      }
      state.screen = navTarget;
      render();
      if (navTarget === "projects" && state.selectedTeamId) {
        void loadTeamProjects(render, state.selectedTeamId);
      }
      if (navTarget === "users" && state.selectedTeamId) {
        void loadTeamUsers(render, state.selectedTeamId);
      }
      return;
    }

    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) {
      return;
    }

    if (action === "login-with-github") {
      void startGithubLogin(render);
      return;
    }

    if (action === "open-new-team") {
      void openTeamSetup(render);
      return;
    }

    if (action === "open-new-project") {
      void createProjectForSelectedTeam(render);
      return;
    }

    if (action === "cancel-project-creation") {
      cancelProjectCreation(render);
      return;
    }

    if (action === "cancel-project-deletion") {
      cancelProjectDeletion(render);
      return;
    }

    if (action === "cancel-project-permanent-deletion") {
      cancelProjectPermanentDeletion(render);
      return;
    }

    if (action === "cancel-project-rename") {
      cancelProjectRename(render);
      return;
    }

    if (action === "submit-project-creation") {
      setImmediateLoadingButton(event.target.closest("button"), "Creating...");
      await waitForNextPaint();
      void submitProjectCreation(render);
      return;
    }

    if (action === "confirm-project-deletion") {
      setImmediateLoadingButton(event.target.closest("button"), "Deleting...");
      await waitForNextPaint();
      void confirmProjectDeletion(render);
      return;
    }

    if (action === "confirm-project-permanent-deletion") {
      setImmediateLoadingButton(event.target.closest("button"), "Deleting...");
      await waitForNextPaint();
      void confirmProjectPermanentDeletion(render);
      return;
    }

    if (action === "submit-project-rename") {
      setImmediateLoadingButton(event.target.closest("button"), "Saving...");
      await waitForNextPaint();
      void submitProjectRename(render);
      return;
    }

    if (action === "toggle-deleted-projects") {
      toggleDeletedProjects(render);
      return;
    }

    if (action === "toggle-deleted-teams") {
      state.showDeletedTeams = !state.showDeletedTeams;
      render();
      return;
    }

    if (action === "cancel-team-setup") {
      resetTeamSetup();
      render();
      return;
    }

    if (action === "cancel-team-rename") {
      cancelTeamRename(render);
      return;
    }

    if (action === "submit-team-rename") {
      setImmediateLoadingButton(event.target.closest("button"), "Saving...");
      await waitForNextPaint();
      void submitTeamRename(render);
      return;
    }

    if (action === "begin-github-app-install") {
      void beginGithubAppInstall(render);
      return;
    }

    if (action === "begin-team-org-setup") {
      void beginTeamOrgSetup(render);
      return;
    }

    if (action === "finish-team-setup") {
      void finishTeamSetup(render);
      return;
    }

    if (action === "open-github-signup") {
      openExternalUrl("https://github.com/signup");
      return;
    }

    if (action.startsWith("open-external:")) {
      openExternalUrl(action.replace("open-external:", ""));
      return;
    }

    if (action.startsWith("open-team:")) {
      state.selectedTeamId = action.split(":")[1];
      state.screen = "projects";
      render();
      void loadTeamProjects(render, state.selectedTeamId);
      return;
    }

    if (action.startsWith("rename-team:")) {
      void openTeamRename(render, action.split(":")[1]);
      return;
    }

    if (action.startsWith("toggle-project:")) {
      const projectId = action.split(":")[1];
      if (state.expandedProjects.has(projectId)) {
        state.expandedProjects.delete(projectId);
      } else {
        state.expandedProjects.add(projectId);
      }
      render();
      return;
    }

    if (action.startsWith("delete-project:")) {
      void deleteProject(render, action.split(":")[1]);
      return;
    }

    if (action.startsWith("rename-project:")) {
      void openProjectRename(render, action.split(":")[1]);
      return;
    }

    if (action.startsWith("delete-deleted-project:")) {
      void permanentlyDeleteProject(render, action.split(":")[1]);
      return;
    }

    if (action.startsWith("open-glossary:")) {
      state.selectedGlossaryId = action.split(":")[1];
      state.screen = "glossaryEditor";
      render();
      return;
    }

    if (action === "open-glossaries") {
      state.screen = "glossaries";
      render();
      return;
    }

    if (action.startsWith("open-translate:")) {
      state.selectedChapterId = action.split(":")[1];
      state.screen = "translate";
      render();
    }
  });

}
