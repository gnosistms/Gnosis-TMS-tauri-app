import { clearStoredAuthSession } from "./auth-storage.js";
import { loadAiSettingsPage, openAiKeyPage } from "./ai-settings-flow.js";
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
import {
  glossaryBackgroundSyncNeedsExitSync,
  maybeStartGlossaryBackgroundSync,
  startGlossaryBackgroundSyncSession,
  syncAndStopGlossaryBackgroundSyncSession,
} from "./glossary-background-sync.js";
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
import {
  startEditorBackgroundSyncSession,
  syncAndStopEditorBackgroundSyncSession,
} from "./editor-background-sync.js";
import {
  hideNavigationLoadingModal,
  showNavigationLoadingModal,
} from "./navigation-loading.js";
import { resolveNavigationLeaveLoading } from "./navigation-leave-loading.js";
import { clearNoticeBadge, clearScopedSyncBadge, showNoticeBadge } from "./status-feedback.js";

export async function handleNavigation(navTarget, render) {
  const previousScreen = state.screen;
  const glossaryNeedsExitSync =
    previousScreen === "glossaryEditor"
    && navTarget !== "glossaryEditor"
    && glossaryBackgroundSyncNeedsExitSync();
  const leaveLoading = resolveNavigationLeaveLoading(previousScreen, navTarget, {
    glossaryNeedsExitSync,
  });
  const navigationLoadingToken = leaveLoading
    ? showNavigationLoadingModal(leaveLoading.title, leaveLoading.message)
    : null;
  let navigationRendered = false;

  if (navigationLoadingToken !== null) {
    render();
  }

  try {
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
      await syncAndStopEditorBackgroundSyncSession(render);
    }
    if (state.screen === "glossaryEditor" && navTarget !== "glossaryEditor") {
      await syncAndStopGlossaryBackgroundSyncSession(render);
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

    if (navTarget === "aiKey") {
      if (navigationLoadingToken !== null) {
        hideNavigationLoadingModal(navigationLoadingToken);
      }
      openAiKeyPage(render, { returnScreen: previousScreen });
      navigationRendered = true;
      return;
    }

    if (navigationLoadingToken !== null) {
      hideNavigationLoadingModal(navigationLoadingToken);
    }
    state.screen = navTarget;
    render();
    navigationRendered = true;

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
      void waitForNextPaint().then(async () => {
        await loadSelectedGlossaryEditorData(render);
        if (state.screen === "glossaryEditor" && state.glossaryEditor?.status === "ready") {
          startGlossaryBackgroundSyncSession(render);
        }
      });
    }
    if (navTarget === "translate" && state.selectedChapterId) {
      void waitForNextPaint().then(async () => {
        await loadSelectedChapterEditorData(render, { preserveVisibleRows: true });
        if (state.screen === "translate" && state.editorChapter?.status === "ready") {
          startEditorBackgroundSyncSession(render);
        }
      });
    }
  } finally {
    if (!navigationRendered && navigationLoadingToken !== null && hideNavigationLoadingModal(navigationLoadingToken)) {
      render();
    }
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
    await maybeStartGlossaryBackgroundSync(render, { force: true });
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

    if (screen === "aiKey") {
      await loadAiSettingsPage(render);
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
