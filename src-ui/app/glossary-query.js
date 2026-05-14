import { glossaryKeys, queryClient, subscribeQueryObserver } from "./query-client.js";
import { createGlossaryDiscoveryState, state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
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
import { teamCacheKey } from "./team-cache.js";

let activeGlossariesQuerySubscription = null;

export function resetGlossariesQueryObserver() {
  activeGlossariesQuerySubscription?.unsubscribe?.();
  activeGlossariesQuerySubscription?.observer?.destroy?.();
  activeGlossariesQuerySubscription = null;
}

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
  cacheKey,
  cacheUpdatedAt = null,
} = {}) {
  if (state.selectedTeamId !== teamId) {
    return false;
  }

  if (snapshot) {
    const visibleSnapshot = applyGlossaryWriteIntentOverlay(snapshot);
    applyGlossarySnapshotToState(glossarySnapshotFromList(visibleSnapshot.glossaries), {
      teamId,
      fallbackToFirstActive,
      cacheKey,
      cacheUpdatedAt,
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

function normalizeGlossariesSnapshotInput(snapshot) {
  if (Array.isArray(snapshot?.glossaries)) {
    return snapshot.glossaries;
  }
  if (Array.isArray(snapshot)) {
    return snapshot;
  }
  return [];
}

function moveGlossaryToLifecycle(queryData, glossaryId, lifecycleState, patch = {}) {
  if (!queryData || typeof queryData !== "object") {
    return queryData;
  }

  let changed = false;
  const glossaries = (Array.isArray(queryData.glossaries) ? queryData.glossaries : [])
    .map((glossary) => {
      if (glossary?.id !== glossaryId) {
        return glossary;
      }
      changed = true;
      return {
        ...glossary,
        ...patch,
        lifecycleState,
      };
    });

  return changed
    ? {
      ...queryData,
      glossaries,
    }
    : queryData;
}

function removeGlossaryFromQueryData(queryData, glossaryId) {
  if (!queryData || typeof queryData !== "object") {
    return queryData;
  }
  const glossaries = Array.isArray(queryData.glossaries) ? queryData.glossaries : [];
  const nextGlossaries = glossaries.filter((glossary) => glossary?.id !== glossaryId);
  return nextGlossaries.length === glossaries.length
    ? queryData
    : {
      ...queryData,
      glossaries: nextGlossaries,
    };
}

function glossaryLifecycleIntent(glossary) {
  if (typeof glossary?.pendingMutation === "string" && glossary.pendingMutation.trim()) {
    return glossary.pendingMutation.trim();
  }
  if (typeof glossary?.localLifecycleIntent === "string" && glossary.localLifecycleIntent.trim()) {
    return glossary.localLifecycleIntent.trim();
  }
  return "";
}

function glossaryInSnapshot(snapshot, glossaryId) {
  return normalizeGlossariesSnapshotInput(snapshot).find((glossary) => glossary?.id === glossaryId) ?? null;
}

function glossaryLocation(snapshot, glossaryId) {
  const glossary = glossaryInSnapshot(snapshot, glossaryId);
  if (!glossary) {
    return "";
  }
  return glossary.lifecycleState === "deleted" ? "deleted" : "active";
}

function glossaryTitleInSnapshot(snapshot, glossaryId) {
  return glossaryInSnapshot(snapshot, glossaryId)?.title;
}

function patchGlossaryInList(glossaries, glossaryId, patch, fallbackGlossary = null) {
  const currentGlossaries = Array.isArray(glossaries) ? glossaries : [];
  let found = false;
  const patchedGlossaries = currentGlossaries.map((glossary) => {
    if (glossary?.id !== glossaryId) {
      return glossary;
    }
    found = true;
    return {
      ...glossary,
      ...patch,
    };
  });
  if (!found && fallbackGlossary) {
    patchedGlossaries.push({
      ...fallbackGlossary,
      ...patch,
    });
  }
  return patchedGlossaries;
}

export function preserveGlossaryLifecyclePatchesInSnapshot(nextSnapshot, previousSnapshot) {
  if (!nextSnapshot || typeof nextSnapshot !== "object") {
    return nextSnapshot;
  }

  const previousGlossaries = normalizeGlossariesSnapshotInput(previousSnapshot);
  const intentById = new Map(
    previousGlossaries
      .filter((glossary) => typeof glossary?.id === "string" && glossaryLifecycleIntent(glossary))
      .map((glossary) => [glossary.id, glossary]),
  );
  if (intentById.size === 0) {
    return nextSnapshot;
  }

  let nextGlossaries = normalizeGlossariesSnapshotInput(nextSnapshot);
  for (const previousGlossary of intentById.values()) {
    const intent = glossaryLifecycleIntent(previousGlossary);
    const isPending = typeof previousGlossary?.pendingMutation === "string"
      && previousGlossary.pendingMutation.trim();

    if (intent === "softDelete") {
      if (!isPending && glossaryLocation({ glossaries: nextGlossaries }, previousGlossary.id) === "deleted") {
        continue;
      }
      nextGlossaries = patchGlossaryInList(nextGlossaries, previousGlossary.id, {
        lifecycleState: "deleted",
        pendingMutation: isPending ? "softDelete" : null,
        localLifecycleIntent: "softDelete",
      }, previousGlossary);
      continue;
    }

    if (intent === "restore") {
      if (!isPending && glossaryLocation({ glossaries: nextGlossaries }, previousGlossary.id) === "active") {
        continue;
      }
      nextGlossaries = patchGlossaryInList(nextGlossaries, previousGlossary.id, {
        lifecycleState: "active",
        pendingMutation: isPending ? "restore" : null,
        localLifecycleIntent: "restore",
      }, previousGlossary);
      continue;
    }

    if (intent === "rename") {
      if (!isPending && glossaryTitleInSnapshot({ glossaries: nextGlossaries }, previousGlossary.id) === previousGlossary.title) {
        continue;
      }
      nextGlossaries = patchGlossaryInList(nextGlossaries, previousGlossary.id, {
        title: previousGlossary.title,
        pendingMutation: isPending ? "rename" : null,
        localLifecycleIntent: "rename",
      }, previousGlossary);
    }
  }

  return {
    ...nextSnapshot,
    glossaries: nextGlossaries,
  };
}

export function preservePendingGlossaryLifecyclePatches(nextSnapshot, previousSnapshot) {
  return preserveGlossaryLifecyclePatchesInSnapshot(nextSnapshot, previousSnapshot);
}

export function seedGlossariesQueryFromCache(team, {
  teamId = team?.id,
  loadStoredGlossariesForTeam,
  render,
} = {}) {
  if (typeof loadStoredGlossariesForTeam !== "function") {
    return null;
  }

  const expectedCacheKey = teamCacheKey(team);
  const cachedGlossaries = loadStoredGlossariesForTeam(team);
  if (
    state.selectedTeamId !== teamId
    || !cachedGlossaries?.exists
    || cachedGlossaries.cacheKey !== expectedCacheKey
  ) {
    return null;
  }

  const queryKey = glossaryKeys.byTeam(teamId);
  const previousQueryData = queryClient.getQueryData(queryKey);
  const snapshot = preservePendingGlossaryLifecyclePatches(applyGlossaryWriteIntentOverlay(createGlossariesQuerySnapshot({
    glossaries: cachedGlossaries.glossaries,
    status: "ready",
  })), previousQueryData);
  queryClient.setQueryData(queryKey, snapshot);
  applyGlossariesQuerySnapshotToState(snapshot, {
    teamId,
    isFetching: true,
    cacheKey: expectedCacheKey,
    cacheUpdatedAt: cachedGlossaries.updatedAt,
  });
  render?.();
  return snapshot;
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

  const queryKey = glossaryKeys.byTeam(teamId);
  const previousQueryData = queryClient.getQueryData(queryKey);
  const snapshot = preservePendingGlossaryLifecyclePatches(applyGlossaryWriteIntentOverlay(createGlossariesQuerySnapshot({
    glossaries: localGlossaries,
    status: "ready",
  })), previousQueryData);
  queryClient.setQueryData(queryKey, snapshot);
  applyGlossariesQuerySnapshotToState(snapshot, {
    teamId,
    isFetching: true,
    cacheKey: teamCacheKey(team),
  });
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
      const previousQueryData = queryClient.getQueryData(glossaryKeys.byTeam(teamId));
      return preservePendingGlossaryLifecyclePatches(
        applyGlossaryWriteIntentOverlay(nextSnapshot),
        previousQueryData,
      );
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

function createGlossaryLifecycleMutationOptions({
  team,
  glossary,
  mutationType,
  optimisticData = {},
  settledData = {},
  commitMutation,
  onOptimisticApplied,
  onSuccessApplied,
  onErrorApplied,
  render,
} = {}) {
  const teamId = team?.id ?? null;
  const queryKey = glossaryKeys.byTeam(teamId);
  return {
    mutationKey: ["glossary", mutationType, glossary?.id ?? null],
    scope: { id: `team-metadata:${team?.installationId ?? "unknown"}` },
    mutationFn: async () => {
      if (typeof commitMutation !== "function") {
        return;
      }
      const mutation = {
        type: mutationType,
        resourceId: glossary.id,
        glossaryId: glossary.id,
      };
      if (mutationType === "rename") {
        mutation.title = optimisticData.title;
        mutation.previousTitle = glossary.title;
      }
      await commitMutation(team, mutation);
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey });
      const previousQueryData = queryClient.getQueryData(queryKey);
      let optimisticQueryData = previousQueryData;
      if (mutationType === "softDelete") {
        optimisticQueryData = moveGlossaryToLifecycle(previousQueryData, glossary.id, "deleted", optimisticData);
      } else if (mutationType === "restore") {
        optimisticQueryData = moveGlossaryToLifecycle(previousQueryData, glossary.id, "active", optimisticData);
      } else if (mutationType === "permanentDelete") {
        optimisticQueryData = removeGlossaryFromQueryData(previousQueryData, glossary.id);
      } else {
        optimisticQueryData = patchGlossaryQueryData(previousQueryData, glossary.id, optimisticData);
      }
      if (optimisticQueryData) {
        queryClient.setQueryData(queryKey, optimisticQueryData);
        applyGlossariesQuerySnapshotToState(optimisticQueryData, {
          teamId,
          isFetching: state.glossariesPage?.isRefreshing === true,
        });
      }
      onOptimisticApplied?.(optimisticQueryData);
      render?.();
      return { previousQueryData };
    },
    onError: (error, _variables, context) => {
      if (context?.previousQueryData) {
        queryClient.setQueryData(queryKey, context.previousQueryData);
        applyGlossariesQuerySnapshotToState(context.previousQueryData, {
          teamId,
          isFetching: state.glossariesPage?.isRefreshing === true,
        });
      }
      onErrorApplied?.(error, context);
      if (typeof render === "function") {
        showNoticeBadge(error?.message ?? String(error), render);
      }
      render?.();
    },
    onSuccess: () => {
      const currentQueryData = queryClient.getQueryData(queryKey);
      let settledQueryData = currentQueryData;
      if (mutationType === "softDelete") {
        settledQueryData = moveGlossaryToLifecycle(currentQueryData, glossary.id, "deleted", settledData);
      } else if (mutationType === "restore") {
        settledQueryData = moveGlossaryToLifecycle(currentQueryData, glossary.id, "active", settledData);
      } else if (mutationType === "permanentDelete") {
        settledQueryData = removeGlossaryFromQueryData(currentQueryData, glossary.id);
      } else {
        settledQueryData = patchGlossaryQueryData(currentQueryData, glossary.id, settledData);
      }
      if (settledQueryData) {
        queryClient.setQueryData(queryKey, settledQueryData);
        applyGlossariesQuerySnapshotToState(settledQueryData, {
          teamId,
          isFetching: state.glossariesPage?.isRefreshing === true,
        });
      }
      onSuccessApplied?.(settledQueryData);
      render?.();
    },
    onSettled: async () => {
      await invalidateGlossariesQueryAfterMutation(team, {
        teamId,
        render,
        refetchIfInactive: false,
      });
    },
  };
}

export function createGlossaryRenameMutationOptions({
  team,
  glossary,
  nextTitle,
  commitMutation,
  onOptimisticApplied,
  onSuccessApplied,
  onErrorApplied,
  render,
} = {}) {
  return createGlossaryLifecycleMutationOptions({
    team,
    glossary,
    mutationType: "rename",
    optimisticData: {
      title: nextTitle,
      pendingMutation: "rename",
    },
    settledData: {
      title: nextTitle,
      pendingMutation: null,
      localLifecycleIntent: "rename",
    },
    commitMutation,
    onOptimisticApplied,
    onSuccessApplied,
    onErrorApplied,
    render,
  });
}

export function createGlossarySoftDeleteMutationOptions(options = {}) {
  return createGlossaryLifecycleMutationOptions({
    ...options,
    mutationType: "softDelete",
    optimisticData: {
      lifecycleState: "deleted",
      pendingMutation: "softDelete",
    },
    settledData: {
      lifecycleState: "deleted",
      pendingMutation: null,
      localLifecycleIntent: "softDelete",
    },
  });
}

export function createGlossaryRestoreMutationOptions(options = {}) {
  return createGlossaryLifecycleMutationOptions({
    ...options,
    mutationType: "restore",
    optimisticData: {
      lifecycleState: "active",
      pendingMutation: "restore",
    },
    settledData: {
      lifecycleState: "active",
      pendingMutation: null,
      localLifecycleIntent: "restore",
    },
  });
}

export function createGlossaryPermanentDeleteMutationOptions(options = {}) {
  return createGlossaryLifecycleMutationOptions({
    ...options,
    mutationType: "permanentDelete",
  });
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
