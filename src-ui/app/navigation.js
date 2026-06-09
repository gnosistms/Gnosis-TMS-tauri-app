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
import {
  loadSelectedGlossaryEditorData,
  loadTeamGlossaries,
  primeGlossariesLoadingState,
  primeSelectedGlossaryEditorLoadingState,
} from "./glossary-flow.js";
import {
  loadSelectedQaListEditorData,
  loadTeamQaLists,
  primeQaListsLoadingState,
  primeSelectedQaListEditorLoadingState,
} from "./qa-list-flow.js";
import {
  glossaryBackgroundSyncNeedsExitSync,
  maybeStartGlossaryBackgroundSync,
  startGlossaryBackgroundSyncSession,
  syncAndStopGlossaryBackgroundSyncSession,
} from "./glossary-background-sync.js";
import {
  maybeStartQaListBackgroundSync,
  qaListBackgroundSyncNeedsExitSync,
  startQaListBackgroundSyncSession,
  syncAndStopQaListBackgroundSyncSession,
} from "./qa-background-sync.js";
import {
  loadTeamProjects,
  primeProjectsLoadingState,
} from "./project-flow.js";
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
  stopEditorBackgroundSyncSession,
  syncEditorBackgroundNowWithSummary,
  syncAndStopEditorBackgroundSyncSession,
} from "./editor-background-sync.js";
import {
  hideNavigationLoadingModal,
  showNavigationLoadingModal,
} from "./navigation-loading.js";
import { resolveNavigationLeaveLoading } from "./navigation-leave-loading.js";
import {
  clearNoticeBadge,
  clearScopedSyncBadge,
  showNoticeBadge,
  showScopedSyncBadge,
} from "./status-feedback.js";
import { refreshCurrentUserTeamAccess } from "./team-query.js";
import { setResourcePageRefreshing } from "./resource-page-controller.js";

async function refreshVisibleTeamAccess(render) {
  if (!state.selectedTeamId || state.screen === "teams") {
    return;
  }

  await refreshCurrentUserTeamAccess({ render });
}

function beginRefreshButtonFeedback(screen, render) {
  if (screen === "projects") {
    setResourcePageRefreshing(state.projectsPage, true);
    showScopedSyncBadge("projects", "Refreshing project list...", render);
    return;
  }

  if (screen === "glossaries") {
    state.glossariesPage.isRefreshing = true;
    showScopedSyncBadge("glossaries", "Refreshing glossary list...", render);
    return;
  }

  if (screen === "qa") {
    setResourcePageRefreshing(state.qaListsPage, true);
    showScopedSyncBadge("qa", "Refreshing QA lists...", render);
    return;
  }

  if (screen === "teams") {
    state.teamsPage.isRefreshing = true;
    showScopedSyncBadge("teams", "Refreshing teams...", render);
    return;
  }

  if (screen === "users") {
    state.membersPage.isRefreshing = true;
    showScopedSyncBadge("members", "Refreshing member list...", render);
    render();
    return;
  }

  beginPageSync();
  render();
}

function failRefreshButtonFeedback(screen, render) {
  if (screen === "projects") {
    setResourcePageRefreshing(state.projectsPage, false);
    clearScopedSyncBadge("projects", null);
  } else if (screen === "glossaries") {
    state.glossariesPage.isRefreshing = false;
    clearScopedSyncBadge("glossaries", null);
  } else if (screen === "qa") {
    setResourcePageRefreshing(state.qaListsPage, false);
    clearScopedSyncBadge("qa", null);
  } else if (screen === "teams") {
    state.teamsPage.isRefreshing = false;
    clearScopedSyncBadge("teams", null);
  } else if (screen === "users") {
    state.membersPage.isRefreshing = false;
    clearScopedSyncBadge("members", null);
  } else {
    failPageSync();
  }
  render();
}

function syncSummaryNeedsLocalEditorReload(syncResult) {
  if (!syncResult || syncResult.performedBlockingReload === true) {
    return false;
  }
  if (syncResult.requiresChapterReload === true || syncResult.requiresBlockingReload === true) {
    return true;
  }

  const payload = syncResult.payload;
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const changedRowKeys = [
    "changedRowIds",
    "insertedRowIds",
    "deletedRowIds",
    "affectedChapterIds",
  ];
  if (changedRowKeys.some((key) => Array.isArray(payload[key]) && payload[key].length > 0)) {
    return true;
  }

  return (
    payload.chapterLanguagesChanged === true
    || (
      typeof payload.newHeadSha === "string"
      && payload.newHeadSha.trim()
      && payload.newHeadSha !== payload.oldHeadSha
    )
  );
}

export async function handleNavigation(navTarget, render) {
  const previousScreen = state.screen;
  const glossaryNeedsExitSync =
    previousScreen === "glossaryEditor"
    && navTarget !== "glossaryEditor"
    && glossaryBackgroundSyncNeedsExitSync();
  const qaListNeedsExitSync =
    previousScreen === "qaListEditor"
    && navTarget !== "qaListEditor"
    && qaListBackgroundSyncNeedsExitSync();
  const leaveLoading = resolveNavigationLeaveLoading(previousScreen, navTarget, {
    glossaryNeedsExitSync,
    qaListNeedsExitSync,
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
      if (navTarget === "projects") {
        void stopEditorBackgroundSyncSession()?.catch(() => null);
      } else {
        await syncAndStopEditorBackgroundSyncSession(render);
      }
    }
    if (state.screen === "glossaryEditor" && navTarget !== "glossaryEditor") {
      await syncAndStopGlossaryBackgroundSyncSession(render);
    }
    if (state.screen === "qaListEditor" && navTarget !== "qaListEditor") {
      await syncAndStopQaListBackgroundSyncSession(render);
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
    if (navTarget === "qa" && state.selectedTeamId) {
      primeQaListsLoadingState(state.selectedTeamId, {
        preserveVisibleData: previousScreen === "qaListEditor" && state.qaLists.length > 0,
      });
    }
    if (navTarget === "qaListEditor" && state.selectedQaListId) {
      primeSelectedQaListEditorLoadingState();
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
    if (navTarget === "projects" && state.selectedTeamId) {
      primeProjectsLoadingState(state.selectedTeamId);
      showScopedSyncBadge("projects", "Refreshing project list...", null);
    }
    render();
    navigationRendered = true;

    if (navTarget === "projects" && state.selectedTeamId) {
      void waitForNextPaint().then(async () => {
        try {
          await refreshVisibleTeamAccess(render);
          await loadTeamProjects(render, state.selectedTeamId);
        } finally {
          setResourcePageRefreshing(state.projectsPage, false);
          clearScopedSyncBadge("projects", render);
          render();
        }
        return null;
      });
    }
    if (navTarget === "teams") {
      void waitForNextPaint().then(() => loadUserTeams(render));
    }
    if (navTarget === "users" && state.selectedTeamId) {
      primeUsersForTeam(state.selectedTeamId);
      render();
      void waitForNextPaint().then(async () => {
        await refreshVisibleTeamAccess(render);
        return loadTeamUsers(render, state.selectedTeamId);
      });
    }
    if (navTarget === "glossaries" && state.selectedTeamId) {
      void waitForNextPaint().then(async () => {
        await refreshVisibleTeamAccess(render);
        return loadTeamGlossaries(render, state.selectedTeamId, {
          preserveVisibleData: preserveVisibleGlossaries,
        });
      });
    }
    if (navTarget === "glossaryEditor" && state.selectedGlossaryId) {
      void waitForNextPaint().then(async () => {
        await refreshVisibleTeamAccess(render);
        await loadSelectedGlossaryEditorData(render);
        if (state.screen === "glossaryEditor" && state.glossaryEditor?.status === "ready") {
          startGlossaryBackgroundSyncSession(render);
        }
      });
    }
    if (navTarget === "qa" && state.selectedTeamId) {
      void waitForNextPaint().then(async () => {
        await refreshVisibleTeamAccess(render);
        return loadTeamQaLists(render, state.selectedTeamId);
      });
    }
    if (navTarget === "qaListEditor" && state.selectedQaListId) {
      void waitForNextPaint().then(async () => {
        await refreshVisibleTeamAccess(render);
        await loadSelectedQaListEditorData(render);
        if (
          state.screen === "qaListEditor"
          && state.qaListEditor?.repoName
          && state.qaListEditor?.status === "ready"
        ) {
          startQaListBackgroundSyncSession(render);
        }
      });
    }
    if (navTarget === "translate" && state.selectedChapterId) {
      void waitForNextPaint().then(async () => {
        await refreshVisibleTeamAccess(render);
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

  beginRefreshButtonFeedback(screen, render);
  await waitForNextPaint();

  if (screen === "projects") {
    try {
      await refreshVisibleTeamAccess(render);
      await loadTeamProjects(render, state.selectedTeamId);
      setResourcePageRefreshing(state.projectsPage, false);
      clearScopedSyncBadge("projects", render);
    } catch (error) {
      failRefreshButtonFeedback(screen, render);
      throw error;
    }
    return;
  }

  if (screen === "glossaries") {
    try {
      await refreshVisibleTeamAccess(render);
      await loadTeamGlossaries(render, state.selectedTeamId, { preserveVisibleData: true });
    } catch (error) {
      failRefreshButtonFeedback(screen, render);
      throw error;
    }
    return;
  }

  if (screen === "glossaryEditor") {
    try {
      await refreshVisibleTeamAccess(render);
      await maybeStartGlossaryBackgroundSync(render, { force: true });
      await loadSelectedGlossaryEditorData(render, { preserveVisibleData: true });
    } catch (error) {
      failRefreshButtonFeedback(screen, render);
      throw error;
    }
    return;
  }

  if (screen === "qa") {
    try {
      await refreshVisibleTeamAccess(render);
      await loadTeamQaLists(render, state.selectedTeamId);
      clearScopedSyncBadge("qa", render);
      render();
    } catch (error) {
      failRefreshButtonFeedback(screen, render);
      throw error;
    }
    return;
  }

  if (screen === "qaListEditor") {
    try {
      await refreshVisibleTeamAccess(render);
      await maybeStartQaListBackgroundSync(render, { force: true });
      await loadSelectedQaListEditorData(render, { preserveVisibleData: true });
    } catch (error) {
      failRefreshButtonFeedback(screen, render);
      throw error;
    }
    return;
  }

  if (screen === "translate") {
    lockScreenScrollSnapshot(screen);
  }

  try {
    if (screen === "teams") {
      await loadUserTeams(render);
      clearScopedSyncBadge("teams", render);
      return;
    }

    if (screen === "users") {
      await refreshVisibleTeamAccess(render);
      await loadTeamUsers(render, state.selectedTeamId);
      clearScopedSyncBadge("members", render);
      return;
    }

    if (screen === "aiKey") {
      await refreshVisibleTeamAccess(render);
      await loadAiSettingsPage(render);
      await completePageSync(render);
      return;
    }

    if (screen === "translate") {
      try {
        await refreshVisibleTeamAccess(render);
      } catch (error) {
        showNoticeBadge(error?.message ?? String(error), render);
      }
      startEditorBackgroundSyncSession(render, { skipInitialSync: true });
      await loadSelectedChapterEditorData(render, { preserveVisibleRows: true });
      const syncResult = await syncEditorBackgroundNowWithSummary(render, {
        skipDirtyFlush: true,
        afterLocalCommit: true,
        suppressConservativeRerender: true,
      });
      if (syncSummaryNeedsLocalEditorReload(syncResult)) {
        await loadSelectedChapterEditorData(render, { preserveVisibleRows: true });
      }
      await completePageSync(render);
      return;
    }

    await completePageSync(render);
  } catch {
    failRefreshButtonFeedback(screen, render);
  } finally {
    if (screen === "translate") {
      unlockScreenScrollSnapshot(screen);
    }
  }
}
