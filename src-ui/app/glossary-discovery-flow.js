import { waitForNextPaint } from "./runtime.js";
import { beginPageSync, completePageSync, failPageSync } from "./page-sync.js";
import { createGlossaryDiscoveryState, state } from "./state.js";
import {
  clearScopedSyncBadge,
  showNoticeBadge,
  showScopedSyncBadge,
} from "./status-feedback.js";
import { selectedTeam } from "./glossary-shared.js";
import { loadStoredGlossariesForTeam } from "./glossary-cache.js";
import {
  applyGlossariesQuerySnapshotToState,
  createGlossariesQueryOptions,
  ensureGlossariesQueryObserver,
  seedGlossariesQueryFromCache,
  seedGlossariesQueryFromLocal,
} from "./glossary-query.js";
import {
  clearResourcePageDataOwner,
} from "./resource-page-controller.js";
import { persistGlossariesForTeam } from "./glossary-top-level-state.js";
import { glossaryKeys, queryClient } from "./query-client.js";
import { classifySyncError } from "./sync-error.js";
import { handleSyncFailure } from "./sync-recovery.js";
import { teamCacheKey } from "./team-cache.js";

function glossariesPageOwnsTeam(team) {
  const expectedCacheKey = teamCacheKey(team);
  return Boolean(
    team?.id
    && expectedCacheKey
    && state.glossariesPage?.visibleTeamId === team.id
    && state.glossariesPage?.visibleCacheKey === expectedCacheKey
  );
}

export function primeGlossariesLoadingState(teamId = state.selectedTeamId, options = {}) {
  const team = selectedTeam(teamId);
  state.selectedTeamId = teamId ?? state.selectedTeamId;
  const preserveVisibleData =
    options.preserveVisibleData === true
    && glossariesPageOwnsTeam(team)
    && state.glossaries.length > 0;
  state.glossaryRepoSyncByRepoName = {};
  state.glossariesPage.isRefreshing = false;
  state.glossariesPage.writeState = "idle";

  if (!Number.isFinite(team?.installationId)) {
    state.glossaries = [];
    state.selectedGlossaryId = null;
    clearResourcePageDataOwner(state.glossariesPage);
    state.glossaryRepoSyncByRepoName = {};
    state.glossaryDiscovery = {
      ...createGlossaryDiscoveryState(),
      status: "ready",
      recoveryMessage: "",
    };
    return;
  }

  if (preserveVisibleData) {
    state.glossaryDiscovery = {
      ...createGlossaryDiscoveryState(),
      status: "ready",
      recoveryMessage: "",
    };
    return;
  }

  state.glossaries = [];
  state.selectedGlossaryId = null;
  clearResourcePageDataOwner(state.glossariesPage);
  state.glossariesPage.isRefreshing = true;
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
          loadStoredGlossariesForTeam,
        });
  return {
    preservedVisibleData: false,
    seededFromCache: Boolean(seededSnapshot),
  };
}

function isGlossaryLoadCurrent(teamId, syncVersionAtStart) {
  return state.selectedTeamId === teamId && state.glossarySyncVersion === syncVersionAtStart;
}

export async function loadTeamGlossaries(
  render,
  teamId = state.selectedTeamId,
  options = {},
) {
  const syncVersionAtStart = state.glossarySyncVersion;
  const requestedPreserveVisibleData = options.preserveVisibleData === true;
  const team = selectedTeam(teamId);
  const primeResult = primeGlossariesLoadingState(teamId, {
    preserveVisibleData: requestedPreserveVisibleData,
  });
  const preservedVisibleData = primeResult?.preservedVisibleData === true;
  state.glossariesPage.isRefreshing = true;
  render?.();

  if (!Number.isFinite(team?.installationId)) {
    state.glossaries = [];
    state.selectedGlossaryId = null;
    state.glossaryDiscovery = {
      ...createGlossaryDiscoveryState(),
      status: "ready",
      recoveryMessage: "",
    };
    state.glossariesPage.isRefreshing = false;
    render();
    return;
  }

  beginPageSync();
  showScopedSyncBadge("glossaries", "Loading glossaries...", render);
  render();
  await waitForNextPaint();
  if (!isGlossaryLoadCurrent(team?.id ?? teamId, syncVersionAtStart)) {
    clearScopedSyncBadge("glossaries", render);
    return;
  }

  try {
    if (!preservedVisibleData) {
      const localSnapshot = await seedGlossariesQueryFromLocal(team, {
        teamId: team.id,
        render,
      });
      if (!isGlossaryLoadCurrent(team.id, syncVersionAtStart)) {
        clearScopedSyncBadge("glossaries", render);
        return;
      }
      if (localSnapshot) {
        await waitForNextPaint();
        if (!isGlossaryLoadCurrent(team.id, syncVersionAtStart)) {
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
    const queryOptions = createGlossariesQueryOptions(team, {
      teamId: team.id,
      preserveVisibleData: preservedVisibleData,
      suppressRecoveryWarning: options.suppressRecoveryWarning === true,
      render,
    });
    const querySnapshot = await queryClient.fetchQuery(queryOptions);
    if (!isGlossaryLoadCurrent(team.id, syncVersionAtStart)) {
      clearScopedSyncBadge("glossaries", render);
      return;
    }
    showScopedSyncBadge("glossaries", "Refreshing glossary list...", render);
    queryClient.setQueryData(glossaryKeys.byTeam(team.id), querySnapshot);
    applyGlossariesQuerySnapshotToState(querySnapshot, {
      teamId: team.id,
      isFetching: false,
    });
    persistGlossariesForTeam(team);

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
    clearScopedSyncBadge("glossaries", render);
    state.glossariesPage.isRefreshing = false;
    render();
  } catch (error) {
    if (!isGlossaryLoadCurrent(team?.id ?? teamId, syncVersionAtStart)) {
      clearScopedSyncBadge("glossaries", render);
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
      clearScopedSyncBadge("glossaries", render);
      state.glossariesPage.isRefreshing = false;
      return;
    }

    failPageSync();
    clearScopedSyncBadge("glossaries", render);
    state.glossariesPage.isRefreshing = false;
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
    render();
  }
}
