import { waitForNextPaint } from "./runtime.js";
import { beginPageSync, completePageSync, failPageSync } from "./page-sync.js";
import { createGlossaryDiscoveryState, state } from "./state.js";
import {
  clearScopedSyncBadge,
  showNoticeBadge,
  showScopedSyncBadge,
} from "./status-feedback.js";
import {
  applyGlossariesQueryDataForTeam,
  currentGlossaryTeam,
  selectedGlossaryTeamMatches,
} from "./glossary-top-level-state.js";
import {
  createGlossariesQueryOptions,
  ensureGlossariesQueryObserver,
  seedGlossariesQueryFromCache,
  seedGlossariesQueryFromLocal,
} from "./glossary-query.js";
import { queryClient } from "./query-client.js";
import {
  clearResourcePageDataOwner,
  setResourcePageRefreshing,
} from "./resource-page-controller.js";
import { teamCacheKey } from "./team-cache.js";
import { classifySyncError } from "./sync-error.js";
import { handleSyncFailure } from "./sync-recovery.js";

function glossariesPageOwnsTeam(team) {
  const expectedCacheKey = teamCacheKey(team);
  return Boolean(
    team?.id
      && expectedCacheKey
      && state.glossariesPage?.visibleTeamId === team.id
      && state.glossariesPage?.visibleCacheKey === expectedCacheKey,
  );
}

function glossariesPageHasDifferentOwner(team) {
  return Boolean(
    (state.glossariesPage?.visibleTeamId || state.glossariesPage?.visibleCacheKey)
      && !glossariesPageOwnsTeam(team),
  );
}

export function primeGlossariesLoadingState(teamId = state.selectedTeamId, options = {}) {
  const team = state.teams.find((item) => item.id === teamId) ?? currentGlossaryTeam();
  const pageOwnsTeam = glossariesPageOwnsTeam(team);
  const pageHasDifferentOwner = glossariesPageHasDifferentOwner(team);
  const preserveVisibleData =
    options.preserveVisibleData === true
    && (pageOwnsTeam || (!pageHasDifferentOwner && selectedGlossaryTeamMatches(team)))
    && state.glossaries.length > 0;
  state.glossaryRepoSyncByRepoName = {};

  if (!team || !Number.isFinite(team?.installationId)) {
    state.glossaries = [];
    state.selectedGlossaryId = null;
    clearResourcePageDataOwner(state.glossariesPage);
    setResourcePageRefreshing(state.glossariesPage, false);
    state.glossaryRepoSyncByRepoName = {};
    state.glossaryDiscovery = {
      ...createGlossaryDiscoveryState(),
      status: "ready",
    };
    return;
  }

  if (preserveVisibleData) {
    state.glossaryDiscovery = {
      ...createGlossaryDiscoveryState(),
      status: "ready",
    };
    return { preservedVisibleData: true, seededFromCache: false };
  }

  state.glossaries = [];
  state.selectedGlossaryId = null;
  clearResourcePageDataOwner(state.glossariesPage);
  setResourcePageRefreshing(state.glossariesPage, true);
  state.glossaryDiscovery = {
    ...createGlossaryDiscoveryState(),
    status: "loading",
    recoveryMessage: "",
  };
  const seededSnapshot =
    options.seedFromCache === false
      ? null
      : seedGlossariesQueryFromCache(team, {
          teamId: team.id,
        });
  return {
    preservedVisibleData: false,
    seededFromCache: Boolean(seededSnapshot),
  };
}

function isGlossaryLoadCurrent(team) {
  return selectedGlossaryTeamMatches(team);
}

export async function loadTeamGlossaries(render, teamId = state.selectedTeamId, options = {}) {
  const team = state.teams.find((item) => item.id === teamId) ?? currentGlossaryTeam();
  const primeResult = primeGlossariesLoadingState(team?.id ?? teamId, {
    preserveVisibleData: options.preserveVisibleData === true,
  });
  const preservedVisibleData = primeResult?.preservedVisibleData === true;
  setResourcePageRefreshing(state.glossariesPage, true);
  render?.();

  if (!team || !Number.isFinite(team?.installationId)) {
    state.glossaries = [];
    state.selectedGlossaryId = null;
    clearResourcePageDataOwner(state.glossariesPage);
    setResourcePageRefreshing(state.glossariesPage, false);
    state.glossaryDiscovery = {
      ...createGlossaryDiscoveryState(),
      status: "ready",
      error: "",
      recoveryMessage: "",
    };
    state.glossaryRepoSyncByRepoName = {};
    render?.();
    return;
  }

  beginPageSync();
  showScopedSyncBadge("glossaries", "Loading glossaries...", render);
  render?.();
  await waitForNextPaint();
  if (!isGlossaryLoadCurrent(team)) {
    clearScopedSyncBadge("glossaries", render);
    return;
  }

  try {
    if (!preservedVisibleData) {
      const localSnapshot = await seedGlossariesQueryFromLocal(team, {
        teamId: team.id,
        render,
      });
      if (!isGlossaryLoadCurrent(team)) {
        clearScopedSyncBadge("glossaries", render);
        return;
      }
      if (localSnapshot) {
        await waitForNextPaint();
        if (!isGlossaryLoadCurrent(team)) {
          clearScopedSyncBadge("glossaries", render);
          return;
        }
      }
    }

    ensureGlossariesQueryObserver(render, team, {
      teamId: team.id,
      preserveVisibleData: preservedVisibleData,
      suppressRecoveryWarning: options.suppressRecoveryWarning === true,
    });
    const querySnapshot = await queryClient.fetchQuery(createGlossariesQueryOptions(team, {
      teamId: team.id,
      preserveVisibleData: preservedVisibleData,
      suppressRecoveryWarning: options.suppressRecoveryWarning === true,
      render,
    }));
    if (!isGlossaryLoadCurrent(team)) {
      clearScopedSyncBadge("glossaries", render);
      return;
    }
    showScopedSyncBadge("glossaries", "Refreshing glossaries...", render);
    applyGlossariesQueryDataForTeam(team, querySnapshot, null, { isFetching: false });

    const syncIssueText =
      typeof querySnapshot.syncIssue?.message === "string"
        ? querySnapshot.syncIssue.message
        : typeof querySnapshot.syncIssue === "string"
          ? querySnapshot.syncIssue
          : "";
    const brokerWarning = querySnapshot.discovery?.brokerWarning ?? "";
    if (syncIssueText) {
      showNoticeBadge(syncIssueText, render);
    } else if (brokerWarning) {
      showNoticeBadge(brokerWarning, render);
    }
    await completePageSync(render);
  } catch (error) {
    if (!isGlossaryLoadCurrent(team)) {
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
    state.glossaryRepoSyncByRepoName = {};
    const hasVisibleLocalData = state.glossaries.length > 0;
    if (!preservedVisibleData && !hasVisibleLocalData && state.glossaryDiscovery?.status !== "ready") {
      state.glossaryDiscovery = {
        ...createGlossaryDiscoveryState(),
        status: "error",
        error: error?.message ?? String(error),
        recoveryMessage: "",
      };
    } else {
      state.glossaryDiscovery = {
        ...createGlossaryDiscoveryState(),
        status: "ready",
        brokerWarning: state.glossaryDiscovery?.brokerWarning ?? "",
        recoveryMessage: state.glossaryDiscovery?.recoveryMessage ?? "",
      };
    }
    showNoticeBadge(error?.message ?? String(error), render);
  } finally {
    if (isGlossaryLoadCurrent(team)) {
      clearScopedSyncBadge("glossaries", render);
      setResourcePageRefreshing(state.glossariesPage, false);
    }
  }
  render?.();
}
