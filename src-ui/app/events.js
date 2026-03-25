import { openExternalUrl } from "./runtime.js";
import {
  resetSessionState,
  resetTeamSetup,
  state,
} from "./state.js";
import { startGithubLogin } from "./auth-flow.js";
import {
  beginGithubAppInstall,
  beginTeamOrgSetup,
  finishTeamSetup,
  loadUserTeams,
  openTeamSetup,
} from "./team-setup-flow.js";
import {
  cancelProjectCreation,
  createProjectForSelectedTeam,
  loadTeamProjects,
  submitProjectCreation,
  updateProjectCreationName,
} from "./project-flow.js";
import { loadTeamUsers } from "./user-flow.js";

export function registerAppEvents(render) {
  document.addEventListener("input", (event) => {
    const projectNameInput = event.target.closest("[data-project-name-input]");
    if (projectNameInput) {
      updateProjectCreationName(render, projectNameInput.value);
    }
  });

  document.addEventListener("click", (event) => {
    const navTarget = event.target.closest("[data-nav-target]")?.dataset.navTarget;
    if (navTarget) {
      if (navTarget === "start") {
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

    if (action === "submit-project-creation") {
      void submitProjectCreation(render);
      return;
    }

    if (action === "refresh-organizations") {
      void loadUserTeams(render);
      return;
    }

    if (action === "reconnect-github") {
      void startGithubLogin(render);
      return;
    }

    if (action === "cancel-team-setup") {
      resetTeamSetup();
      render();
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
