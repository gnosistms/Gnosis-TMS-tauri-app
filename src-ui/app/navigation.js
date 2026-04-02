import { clearStoredAuthSession } from "./auth-storage.js";
import { resetPageSync, beginPageSync, completePageSync, failPageSync } from "./page-sync.js";
import { state, resetSessionState } from "./state.js";
import { waitForNextPaint } from "./runtime.js";
import { loadGithubAppTestConfig } from "./github-app-test-flow.js";
import { loadTeamProjects } from "./project-flow.js";
import { loadUserTeams } from "./team-setup-flow.js";
import { loadTeamUsers, primeUsersForTeam } from "./team-members-flow.js";

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
    void waitForNextPaint().then(() => loadTeamProjects(render, state.selectedTeamId));
  }
  if (navTarget === "teams") {
    void waitForNextPaint().then(() => loadUserTeams(render));
  }
  if (navTarget === "users" && state.selectedTeamId) {
    primeUsersForTeam(state.selectedTeamId);
    render();
    void waitForNextPaint().then(() => loadTeamUsers(render, state.selectedTeamId));
  }
}

export async function refreshCurrentScreen(render) {
  if (state.offline.isEnabled) {
    return;
  }

  beginPageSync();
  render();
  await waitForNextPaint();

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
