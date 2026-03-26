import { clearStoredAuthSession } from "./auth-storage.js";
import { resetPageSync, beginPageSync, completePageSync, failPageSync } from "./page-sync.js";
import { resetSessionState, state } from "./state.js";
import { loadGithubAppTestConfig } from "./github-app-test-flow.js";
import { loadTeamProjects } from "./project-flow.js";
import { loadUserTeams } from "./team-setup-flow.js";
import { loadTeamUsers } from "./user-flow.js";

export function handleNavigation(navTarget, render) {
  if (navTarget === "start") {
    void clearStoredAuthSession();
    resetSessionState();
  } else {
    resetPageSync();
  }

  state.screen = navTarget;
  render();

  if (navTarget === "projects" && state.selectedTeamId) {
    void loadTeamProjects(render, state.selectedTeamId);
  }
  if (navTarget === "teams") {
    void loadUserTeams(render);
  }
  if (navTarget === "users" && state.selectedTeamId) {
    void loadTeamUsers(render, state.selectedTeamId);
  }
}

export async function refreshCurrentScreen(render) {
  beginPageSync();
  render();

  try {
    if (state.screen === "teams") {
      await loadUserTeams(render);
      return;
    }

    if (state.screen === "projects") {
      await loadTeamProjects(render, state.selectedTeamId);
      return;
    }

    if (state.screen === "users") {
      await loadTeamUsers(render, state.selectedTeamId);
      return;
    }

    if (state.screen === "githubAppTest") {
      await loadGithubAppTestConfig(render);
      completePageSync(render);
      render();
      return;
    }

    completePageSync(render);
    render();
  } catch {
    failPageSync();
    render();
  }
}
