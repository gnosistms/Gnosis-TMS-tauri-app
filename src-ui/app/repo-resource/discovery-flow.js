import { waitForNextPaint } from "../runtime.js";
import { beginPageSync, completePageSync, failPageSync } from "../page-sync.js";
import { state } from "../state.js";
import {
  clearScopedSyncBadge,
  showNoticeBadge,
  showScopedSyncBadge,
} from "../status-feedback.js";
import { queryClient } from "../query-client.js";
import {
  clearResourcePageDataOwner,
  setResourcePageRefreshing,
} from "../resource-page-controller.js";
import { teamCacheKey } from "../team-cache.js";
import { classifySyncError } from "../sync-error.js";
import { handleSyncFailure } from "../sync-recovery.js";

// Shared discovery-flow engine for glossary / QA-list. The two flows are mirrors apart from a
// handful of per-domain values; a `descriptor` supplies them so the prime + load logic lives once.
//
// Descriptor shape:
//   collectionField     state key for the visible list ("glossaries" / "qaLists")
//   selectedIdField     state key for the selected id ("selectedGlossaryId" / "selectedQaListId")
//   pageField           state key for the resource page ("glossariesPage" / "qaListsPage")
//   discoveryField      state key for discovery status ("glossaryDiscovery" / "qaListDiscovery")
//   createDiscoveryState()            fresh discovery-state object
//   badgeScope          scoped-sync-badge key ("glossaries" / "qa")
//   pluralNoun          user-facing plural noun ("glossaries" / "QA lists")
//   resetRepoSyncState()             clears per-repo sync map; no-op for QA (R4 residue)
//   currentTeam() / selectedTeamMatches(team)
//   applyQueryDataForTeam / createQueryOptions / ensureQueryObserver
//   seedQueryFromCache / seedQueryFromLocal
export function createRepoResourceDiscoveryFlow(descriptor) {
  const {
    collectionField,
    selectedIdField,
    pageField,
    discoveryField,
    createDiscoveryState,
    badgeScope,
    pluralNoun,
    resetRepoSyncState,
    currentTeam,
    selectedTeamMatches,
    applyQueryDataForTeam,
    createQueryOptions,
    ensureQueryObserver,
    seedQueryFromCache,
    seedQueryFromLocal,
  } = descriptor;

  function pageOwnsTeam(team) {
    const expectedCacheKey = teamCacheKey(team);
    return Boolean(
      team?.id
        && expectedCacheKey
        && state[pageField]?.visibleTeamId === team.id
        && state[pageField]?.visibleCacheKey === expectedCacheKey,
    );
  }

  function pageHasDifferentOwner(team) {
    return Boolean(
      (state[pageField]?.visibleTeamId || state[pageField]?.visibleCacheKey)
        && !pageOwnsTeam(team),
    );
  }

  function isLoadCurrent(team) {
    return selectedTeamMatches(team);
  }

  function primeLoadingState(teamId = state.selectedTeamId, options = {}) {
    const team = state.teams.find((item) => item.id === teamId) ?? currentTeam();
    const ownsTeam = pageOwnsTeam(team);
    const differentOwner = pageHasDifferentOwner(team);
    const preserveVisibleData =
      options.preserveVisibleData === true
      && (ownsTeam || (!differentOwner && selectedTeamMatches(team)))
      && state[collectionField].length > 0;
    resetRepoSyncState();

    if (!team || !Number.isFinite(team?.installationId)) {
      state[collectionField] = [];
      state[selectedIdField] = null;
      clearResourcePageDataOwner(state[pageField]);
      setResourcePageRefreshing(state[pageField], false);
      resetRepoSyncState();
      state[discoveryField] = {
        ...createDiscoveryState(),
        status: "ready",
      };
      return;
    }

    if (preserveVisibleData) {
      state[discoveryField] = {
        ...createDiscoveryState(),
        status: "ready",
      };
      return { preservedVisibleData: true, seededFromCache: false };
    }

    state[collectionField] = [];
    state[selectedIdField] = null;
    clearResourcePageDataOwner(state[pageField]);
    setResourcePageRefreshing(state[pageField], true);
    state[discoveryField] = {
      ...createDiscoveryState(),
      status: "loading",
      recoveryMessage: "",
    };
    const seededSnapshot =
      options.seedFromCache === false
        ? null
        : seedQueryFromCache(team, {
            teamId: team.id,
          });
    return {
      preservedVisibleData: false,
      seededFromCache: Boolean(seededSnapshot),
    };
  }

  async function loadTeam(render, teamId = state.selectedTeamId, options = {}) {
    const team = state.teams.find((item) => item.id === teamId) ?? currentTeam();
    const primeResult = primeLoadingState(team?.id ?? teamId, {
      preserveVisibleData: options.preserveVisibleData === true,
    });
    const preservedVisibleData = primeResult?.preservedVisibleData === true;
    setResourcePageRefreshing(state[pageField], true);
    render?.();

    if (!team || !Number.isFinite(team?.installationId)) {
      state[collectionField] = [];
      state[selectedIdField] = null;
      clearResourcePageDataOwner(state[pageField]);
      setResourcePageRefreshing(state[pageField], false);
      state[discoveryField] = {
        ...createDiscoveryState(),
        status: "ready",
        error: "",
        recoveryMessage: "",
      };
      resetRepoSyncState();
      render?.();
      return;
    }

    beginPageSync();
    showScopedSyncBadge(badgeScope, `Loading ${pluralNoun}...`, render);
    render?.();
    await waitForNextPaint();
    if (!isLoadCurrent(team)) {
      clearScopedSyncBadge(badgeScope, render);
      return;
    }

    try {
      if (!preservedVisibleData) {
        const localSnapshot = await seedQueryFromLocal(team, {
          teamId: team.id,
          render,
        });
        if (!isLoadCurrent(team)) {
          clearScopedSyncBadge(badgeScope, render);
          return;
        }
        if (localSnapshot) {
          await waitForNextPaint();
          if (!isLoadCurrent(team)) {
            clearScopedSyncBadge(badgeScope, render);
            return;
          }
        }
      }

      ensureQueryObserver(render, team, {
        teamId: team.id,
        preserveVisibleData: preservedVisibleData,
        suppressRecoveryWarning: options.suppressRecoveryWarning === true,
      });
      const querySnapshot = await queryClient.fetchQuery(createQueryOptions(team, {
        teamId: team.id,
        preserveVisibleData: preservedVisibleData,
        suppressRecoveryWarning: options.suppressRecoveryWarning === true,
        render,
      }));
      if (!isLoadCurrent(team)) {
        clearScopedSyncBadge(badgeScope, render);
        return;
      }
      showScopedSyncBadge(badgeScope, `Refreshing ${pluralNoun}...`, render);
      applyQueryDataForTeam(team, querySnapshot, null, { isFetching: false });

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
      if (!isLoadCurrent(team)) {
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
      resetRepoSyncState();
      const hasVisibleLocalData = state[collectionField].length > 0;
      if (!preservedVisibleData && !hasVisibleLocalData && state[discoveryField]?.status !== "ready") {
        state[discoveryField] = {
          ...createDiscoveryState(),
          status: "error",
          error: error?.message ?? String(error),
          recoveryMessage: "",
        };
      } else {
        state[discoveryField] = {
          ...createDiscoveryState(),
          status: "ready",
          brokerWarning: state[discoveryField]?.brokerWarning ?? "",
          recoveryMessage: state[discoveryField]?.recoveryMessage ?? "",
        };
      }
      showNoticeBadge(error?.message ?? String(error), render);
    } finally {
      if (isLoadCurrent(team)) {
        clearScopedSyncBadge(badgeScope, render);
        setResourcePageRefreshing(state[pageField], false);
      }
    }
    render?.();
  }

  return { primeLoadingState, loadTeam };
}
