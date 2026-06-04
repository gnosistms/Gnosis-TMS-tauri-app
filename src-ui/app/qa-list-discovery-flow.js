import { waitForNextPaint } from "./runtime.js";
import { beginPageSync, completePageSync, failPageSync } from "./page-sync.js";
import { createQaListDiscoveryState, state } from "./state.js";
import {
  clearScopedSyncBadge,
  showNoticeBadge,
  showScopedSyncBadge,
} from "./status-feedback.js";
import {
  applyQaListsQueryDataForTeam,
  currentQaListTeam,
  selectedQaListTeamMatches,
} from "./qa-list-top-level-state.js";
import {
  createQaListsQueryOptions,
  ensureQaListsQueryObserver,
  seedQaListsQueryFromCache,
  seedQaListsQueryFromLocal,
} from "./qa-list-query.js";
import { queryClient } from "./query-client.js";
import {
  clearResourcePageDataOwner,
  setResourcePageRefreshing,
} from "./resource-page-controller.js";
import { teamCacheKey } from "./team-cache.js";
import { classifySyncError } from "./sync-error.js";
import { handleSyncFailure } from "./sync-recovery.js";

function qaListsPageOwnsTeam(team) {
  const expectedCacheKey = teamCacheKey(team);
  return Boolean(
    team?.id
      && expectedCacheKey
      && state.qaListsPage?.visibleTeamId === team.id
      && state.qaListsPage?.visibleCacheKey === expectedCacheKey,
  );
}

export function primeQaListsLoadingState(teamId = state.selectedTeamId, options = {}) {
  const team = state.teams.find((item) => item.id === teamId) ?? currentQaListTeam();
  const preserveVisibleData =
    options.preserveVisibleData === true
    && (qaListsPageOwnsTeam(team) || selectedQaListTeamMatches(team))
    && state.qaLists.length > 0;

  if (!team) {
    state.qaLists = [];
    state.selectedQaListId = null;
    clearResourcePageDataOwner(state.qaListsPage);
    setResourcePageRefreshing(state.qaListsPage, false);
    state.qaListDiscovery = {
      ...createQaListDiscoveryState(),
      status: "ready",
    };
    return;
  }

  if (preserveVisibleData) {
    state.qaListDiscovery = {
      ...createQaListDiscoveryState(),
      status: "ready",
    };
    return { preservedVisibleData: true, seededFromCache: false };
  }

  state.qaLists = [];
  state.selectedQaListId = null;
  clearResourcePageDataOwner(state.qaListsPage);
  setResourcePageRefreshing(state.qaListsPage, true);
  state.qaListDiscovery = {
    ...createQaListDiscoveryState(),
    status: "loading",
    recoveryMessage: "",
  };

  const seededSnapshot = seedQaListsQueryFromCache(team, {
    teamId: team.id,
  });
  return {
    preservedVisibleData: false,
    seededFromCache: Boolean(seededSnapshot),
  };
}

function isQaListLoadCurrent(team) {
  return selectedQaListTeamMatches(team);
}

export async function loadTeamQaLists(render, teamId = state.selectedTeamId, options = {}) {
  const team = state.teams.find((item) => item.id === teamId) ?? currentQaListTeam();
  const primeResult = primeQaListsLoadingState(team?.id ?? teamId, {
    preserveVisibleData: options.preserveVisibleData === true,
  });
  const preservedVisibleData = primeResult?.preservedVisibleData === true;
  setResourcePageRefreshing(state.qaListsPage, true);
  render?.();

  if (!team) {
    state.qaLists = [];
    state.selectedQaListId = null;
    clearResourcePageDataOwner(state.qaListsPage);
    setResourcePageRefreshing(state.qaListsPage, false);
    state.qaListDiscovery = {
      ...createQaListDiscoveryState(),
      status: "ready",
      error: "",
      recoveryMessage: "",
    };
    render?.();
    return;
  }

  beginPageSync();
  showScopedSyncBadge("qa", "Loading QA lists...", render);
  render?.();
  await waitForNextPaint();
  if (!isQaListLoadCurrent(team)) {
    clearScopedSyncBadge("qa", render);
    return;
  }

  try {
    if (!preservedVisibleData) {
      const localSnapshot = await seedQaListsQueryFromLocal(team, {
        teamId: team.id,
        render,
      });
      if (!isQaListLoadCurrent(team)) {
        clearScopedSyncBadge("qa", render);
        return;
      }
      if (localSnapshot) {
        await waitForNextPaint();
        if (!isQaListLoadCurrent(team)) {
          clearScopedSyncBadge("qa", render);
          return;
        }
      }
    }

    ensureQaListsQueryObserver(render, team, { teamId: team.id });
    const querySnapshot = await queryClient.fetchQuery(createQaListsQueryOptions(team, {
      teamId: team.id,
      preserveVisibleData: preservedVisibleData,
    }));
    if (!isQaListLoadCurrent(team)) {
      clearScopedSyncBadge("qa", render);
      return;
    }
    showScopedSyncBadge("qa", "Refreshing QA lists...", render);
    applyQaListsQueryDataForTeam(team, querySnapshot, null, { isFetching: false });
    await completePageSync(render);
  } catch (error) {
    if (!isQaListLoadCurrent(team)) {
      return;
    }
    if (
      await handleSyncFailure(classifySyncError(error), {
        render,
        teamId: team?.id ?? null,
        currentResource: true,
      })
    ) {
      failPageSync();
      return;
    }
    failPageSync();
    if (state.qaLists.length === 0) {
      state.qaListDiscovery = {
        ...createQaListDiscoveryState(),
        status: "error",
        error: error?.message ?? "Could not load QA lists.",
        recoveryMessage: "",
      };
    }
    showNoticeBadge(error?.message ?? String(error), render);
  } finally {
    if (isQaListLoadCurrent(team)) {
      clearScopedSyncBadge("qa", render);
      setResourcePageRefreshing(state.qaListsPage, false);
    }
  }
  render?.();
}
