import { clearStoredAuthSession } from "./auth-storage.js";
import {
  resetPageSync,
  beginPageSync,
  completePageSync,
  failPageSync,
  resetProjectsPageSync,
} from "./page-sync.js";
import { lockScreenScrollSnapshot, unlockScreenScrollSnapshot } from "./scroll-state.js";
import { state, resetSessionState } from "./state.js";
import { waitForNextPaint } from "./runtime.js";
import { loadGithubAppTestConfig } from "./github-app-test-flow.js";
import {
  loadSelectedGlossaryEditorData,
  loadTeamGlossaries,
  primeGlossariesLoadingState,
  primeSelectedGlossaryEditorLoadingState,
} from "./glossary-flow.js";
import { loadTeamProjects } from "./project-flow.js";
import { loadUserTeams } from "./team-setup-flow.js";
import { loadTeamUsers, primeUsersForTeam } from "./team-members-flow.js";
import {
  guardLeavingTranslateEditor,
  guardRefreshingTranslateEditor,
} from "./editor-navigation-guards.js";
import {
  flushDirtyEditorRows,
  loadSelectedChapterEditorData,
  persistEditorChapterSelections,
} from "./translate-flow.js";
import { clearNoticeBadge, clearScopedSyncBadge, showNoticeBadge } from "./status-feedback.js";

export async function handleNavigation(navTarget, render) {
  const previousScreen = state.screen;

  if (!(await guardLeavingTranslateEditor({
    currentScreen: state.screen,
    nextScreen: navTarget,
    render,
    flushDirtyEditorRows,
    showBlockedNotice: (message) => showNoticeBadge(message, render),
  }))) {
    return;
  }

  if (state.screen === "translate" && navTarget !== "translate") {
    void persistEditorChapterSelections(render);
  }

  if (navTarget === "start") {
    void clearStoredAuthSession();
    resetSessionState();
  } else {
    resetPageSync();
    if (navTarget !== "projects") {
      resetProjectsPageSync();
    }
  }

  if (previousScreen === "projects" && navTarget !== "projects") {
    clearNoticeBadge();
    clearScopedSyncBadge("projects", render);
  }

  const preserveVisibleGlossaries =
    navTarget === "glossaries"
    && previousScreen === "glossaryEditor"
    && state.glossaries.length > 0;

  if (navTarget === "glossaries" && state.selectedTeamId) {
    primeGlossariesLoadingState(state.selectedTeamId, {
      preserveVisibleData: preserveVisibleGlossaries,
    });
  }
  if (navTarget === "glossaryEditor" && state.selectedGlossaryId) {
    primeSelectedGlossaryEditorLoadingState();
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
  if (navTarget === "glossaries" && state.selectedTeamId) {
    void waitForNextPaint().then(() =>
      loadTeamGlossaries(render, state.selectedTeamId, {
        preserveVisibleData: preserveVisibleGlossaries,
      })
    );
  }
  if (navTarget === "glossaryEditor" && state.selectedGlossaryId) {
    void waitForNextPaint().then(() => loadSelectedGlossaryEditorData(render));
  }
}

export async function refreshCurrentScreen(render) {
  if (state.offline.isEnabled) {
    return;
  }

  const screen = state.screen;

  if (!(await guardRefreshingTranslateEditor({
    currentScreen: screen,
    render,
    flushDirtyEditorRows,
  }))) {
    return;
  }

  if (screen === "projects") {
    await loadTeamProjects(render, state.selectedTeamId);
    return;
  }

  if (screen === "glossaries") {
    await loadTeamGlossaries(render, state.selectedTeamId, { preserveVisibleData: true });
    return;
  }

  if (screen === "glossaryEditor") {
    await loadSelectedGlossaryEditorData(render, { preserveVisibleData: true });
    return;
  }

  if (screen === "translate") {
    lockScreenScrollSnapshot(screen);
  }

  beginPageSync();
  render();
  await waitForNextPaint();

  try {
    if (screen === "teams") {
      await loadUserTeams(render);
      return;
    }

    if (screen === "users") {
      await loadTeamUsers(render, state.selectedTeamId);
      return;
    }

    if (screen === "githubAppTest") {
      await loadGithubAppTestConfig(render);
      await completePageSync(render);
      return;
    }

    if (screen === "translate") {
      await loadSelectedChapterEditorData(render, { preserveVisibleRows: true });
      await completePageSync(render);
      return;
    }

    await completePageSync(render);
  } catch {
    failPageSync();
    render();
  } finally {
    if (screen === "translate") {
      unlockScreenScrollSnapshot(screen);
    }
  }
}
