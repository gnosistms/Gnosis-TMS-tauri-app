import { glossaryKeys, queryClient, subscribeQueryObserver } from "./query-client.js";
import { createGlossaryDiscoveryState, state } from "./state.js";
import {
  listLocalGlossarySummariesForTeam,
  loadRepoBackedGlossariesForTeam,
} from "./glossary-repo-flow.js";
import {
  applyGlossarySnapshotToState,
  glossarySnapshotFromList,
  persistGlossariesForTeam,
} from "./glossary-top-level-state.js";
import {
  applyGlossaryWriteIntentsToSnapshot,
  clearConfirmedGlossaryWriteIntents,
} from "./glossary-write-coordinator.js";

let activeGlossariesQuerySubscription = null;

function glossaryRepoSyncByRepoName(syncSnapshots = []) {
  return Object.fromEntries(
    (Array.isArray(syncSnapshots) ? syncSnapshots : [])
      .map((snapshot) => [
        typeof snapshot?.repoName === "string" ? snapshot.repoName : "",
        snapshot,
      ])
      .filter(([repoName]) => repoName),
  );
}

export function createGlossariesQuerySnapshot({
  glossaries = [],
  syncSnapshots = [],
  syncIssue = "",
  brokerWarning = "",
  recoveryMessage = "",
  error = "",
  status = "ready",
} = {}) {
  return {
    glossaries: Array.isArray(glossaries) ? glossaries : [],
    repoSyncByRepoName: glossaryRepoSyncByRepoName(syncSnapshots),
    syncIssue,
    discovery: {
      ...createGlossaryDiscoveryState(),
      status,
      brokerWarning: typeof brokerWarning === "string" ? brokerWarning : "",
      recoveryMessage: typeof recoveryMessage === "string" ? recoveryMessage : "",
      error: typeof error === "string" ? error : "",
    },
  };
}

function applyGlossaryWriteIntentOverlay(snapshot) {
  clearConfirmedGlossaryWriteIntents(snapshot);
  return applyGlossaryWriteIntentsToSnapshot(snapshot);
}

export function applyGlossariesQuerySnapshotToState(snapshot, {
  teamId = state.selectedTeamId,
  isFetching = false,
  fallbackToFirstActive = true,
} = {}) {
  if (state.selectedTeamId !== teamId) {
    return false;
  }

  if (snapshot) {
    const visibleSnapshot = applyGlossaryWriteIntentOverlay(snapshot);
    applyGlossarySnapshotToState(glossarySnapshotFromList(visibleSnapshot.glossaries), {
      teamId,
      fallbackToFirstActive,
    });
    state.glossaryRepoSyncByRepoName =
      snapshot.repoSyncByRepoName && typeof snapshot.repoSyncByRepoName === "object"
        ? snapshot.repoSyncByRepoName
        : {};
    state.glossaryDiscovery = {
      ...createGlossaryDiscoveryState(),
      ...(snapshot.discovery ?? {}),
    };
  }

  state.glossariesPage.isRefreshing = isFetching === true;
  return true;
}

export function patchGlossaryQueryData(queryData, glossaryId, patch) {
  if (!queryData || typeof queryData !== "object") {
    return queryData;
  }

  let changed = false;
  const nextGlossaries = (Array.isArray(queryData.glossaries) ? queryData.glossaries : [])
    .map((glossary) => {
      if (glossary?.id !== glossaryId) {
        return glossary;
      }
      changed = true;
      return {
        ...glossary,
        ...patch,
      };
    });

  return changed
    ? {
      ...queryData,
      glossaries: nextGlossaries,
    }
    : queryData;
}

export async function seedGlossariesQueryFromLocal(team, {
  teamId = team?.id,
  render,
  persist = true,
} = {}) {
  const localGlossaries = await listLocalGlossarySummariesForTeam(team);
  if (!localGlossaries.length || state.selectedTeamId !== teamId) {
    return null;
  }

  const snapshot = applyGlossaryWriteIntentOverlay(createGlossariesQuerySnapshot({
    glossaries: localGlossaries,
    status: "ready",
  }));
  queryClient.setQueryData(glossaryKeys.byTeam(teamId), snapshot);
  applyGlossariesQuerySnapshotToState(snapshot, { teamId, isFetching: true });
  if (persist) {
    persistGlossariesForTeam(team);
  }
  render?.();
  return snapshot;
}

export function createGlossariesQueryOptions(team, options = {}) {
  const teamId = options.teamId ?? team?.id ?? null;
  return {
    queryKey: glossaryKeys.byTeam(teamId),
    queryFn: async () => {
      const {
        glossaries,
        syncIssue,
        brokerWarning,
        syncSnapshots = [],
        recoveryMessage = "",
      } = await loadRepoBackedGlossariesForTeam(team, {
        offlineMode: state.offline?.isEnabled === true,
        suppressRecoveryWarning: options.suppressRecoveryWarning === true,
        onRecoveryDetected: (message) => {
          if (state.selectedTeamId !== teamId) {
            return;
          }
          state.glossaryDiscovery = {
            ...createGlossaryDiscoveryState(),
            status: "loading",
            recoveryMessage: message,
          };
          options.render?.();
        },
      });

      let nextGlossaries = Array.isArray(glossaries) ? glossaries : [];
      if (options.preserveVisibleData === true && nextGlossaries.length === 0) {
        const localGlossaries = await listLocalGlossarySummariesForTeam(team);
        if (localGlossaries.length > 0) {
          nextGlossaries = localGlossaries;
        }
      }

      const nextSnapshot = createGlossariesQuerySnapshot({
        glossaries: nextGlossaries,
        syncSnapshots,
        syncIssue,
        brokerWarning,
        recoveryMessage,
        status: "ready",
      });
      return applyGlossaryWriteIntentOverlay(nextSnapshot);
    },
  };
}

export function ensureGlossariesQueryObserver(render, team, options = {}) {
  const teamId = options.teamId ?? team?.id ?? null;
  const queryKey = glossaryKeys.byTeam(teamId);
  const currentKey = JSON.stringify(queryKey);
  if (activeGlossariesQuerySubscription?.key === currentKey) {
    activeGlossariesQuerySubscription.observer?.setOptions?.(
      createGlossariesQueryOptions(team, {
        ...options,
        teamId,
        render,
      }),
    );
    return activeGlossariesQuerySubscription;
  }

  activeGlossariesQuerySubscription?.unsubscribe?.();
  const subscription = subscribeQueryObserver(
    createGlossariesQueryOptions(team, {
      ...options,
      teamId,
      render,
    }),
    (result) => {
      if (result.data) {
        applyGlossariesQuerySnapshotToState(result.data, {
          teamId,
          isFetching: result.isFetching,
        });
      } else if (result.error && state.selectedTeamId === teamId) {
        state.glossaryDiscovery = {
          ...createGlossaryDiscoveryState(),
          status: "error",
          error: result.error?.message ?? String(result.error),
        };
        state.glossariesPage.isRefreshing = result.isFetching;
      } else if (state.selectedTeamId === teamId) {
        state.glossariesPage.isRefreshing = result.isFetching;
      }
      render?.();
    },
  );

  activeGlossariesQuerySubscription = {
    ...subscription,
    key: currentKey,
    teamId,
  };
  return activeGlossariesQuerySubscription;
}

export async function invalidateGlossariesQueryAfterMutation(team, options = {}) {
  const teamId = options.teamId ?? team?.id ?? null;
  const queryKey = glossaryKeys.byTeam(teamId);
  const query = queryClient.getQueryCache().find({ queryKey });
  const hasActiveObserver = typeof query?.getObserversCount === "function"
    ? query.getObserversCount() > 0
    : false;

  await queryClient.invalidateQueries({
    queryKey,
    refetchType: hasActiveObserver ? "active" : "none",
  });

  if (!hasActiveObserver && options.refetchIfInactive !== false) {
    await queryClient.fetchQuery(createGlossariesQueryOptions(team, {
      ...options,
      teamId,
    }));
  }
}
