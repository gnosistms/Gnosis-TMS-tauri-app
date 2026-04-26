import { createMutationObserver, glossaryKeys, queryClient, subscribeQueryObserver } from "./query-client.js";
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

export function applyGlossariesQuerySnapshotToState(snapshot, {
  teamId = state.selectedTeamId,
  isFetching = false,
  fallbackToFirstActive = true,
} = {}) {
  if (state.selectedTeamId !== teamId) {
    return false;
  }

  if (snapshot) {
    applyGlossarySnapshotToState(glossarySnapshotFromList(snapshot.glossaries), {
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

export function preservePendingGlossaryLifecyclePatches(nextSnapshot, previousSnapshot) {
  if (!nextSnapshot || typeof nextSnapshot !== "object") {
    return nextSnapshot;
  }

  const pendingById = new Map(
    (Array.isArray(previousSnapshot?.glossaries) ? previousSnapshot.glossaries : [])
      .filter((glossary) =>
        typeof glossary?.id === "string"
        && typeof glossary?.pendingMutation === "string"
        && glossary.pendingMutation.trim()
      )
      .map((glossary) => [glossary.id, glossary]),
  );
  if (pendingById.size === 0) {
    return nextSnapshot;
  }

  let changed = false;
  const glossaries = (Array.isArray(nextSnapshot.glossaries) ? nextSnapshot.glossaries : [])
    .map((glossary) => {
      const pendingGlossary = pendingById.get(glossary?.id);
      if (!pendingGlossary) {
        return glossary;
      }

      changed = true;
      return {
        ...glossary,
        ...(pendingGlossary.pendingMutation === "rename"
          ? { title: pendingGlossary.title }
          : {}),
        ...(pendingGlossary.pendingMutation === "softDelete" || pendingGlossary.pendingMutation === "restore"
          ? { lifecycleState: pendingGlossary.lifecycleState }
          : {}),
        pendingMutation: pendingGlossary.pendingMutation,
      };
    });

  return changed
    ? {
      ...nextSnapshot,
      glossaries,
    }
    : nextSnapshot;
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

  const snapshot = createGlossariesQuerySnapshot({
    glossaries: localGlossaries,
    status: "ready",
  });
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
      return preservePendingGlossaryLifecyclePatches(
        nextSnapshot,
        queryClient.getQueryData(glossaryKeys.byTeam(teamId)),
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

function createGlossaryLifecycleMutationOptions({
  team,
  glossary,
  mutationType,
  optimisticPatch,
  settledPatch = {},
  commitMutation,
  onOptimisticApplied,
  render,
} = {}) {
  const teamId = team?.id ?? null;
  const queryKey = glossaryKeys.byTeam(teamId);
  return {
    mutationKey: ["glossary", mutationType, glossary?.id ?? null],
    scope: { id: `team-metadata:${team?.installationId}` },
    mutationFn: async () => {
      const mutation = {
        type: mutationType,
        resourceId: glossary.id,
        glossaryId: glossary.id,
      };
      if (mutationType === "rename") {
        mutation.title = optimisticPatch.title;
        mutation.previousTitle = glossary.title;
      }
      await commitMutation(team, mutation);
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey });
      const previousQueryData = queryClient.getQueryData(queryKey);
      const optimisticQueryData = patchGlossaryQueryData(previousQueryData, glossary.id, optimisticPatch);
      if (optimisticQueryData) {
        queryClient.setQueryData(queryKey, optimisticQueryData);
        applyGlossariesQuerySnapshotToState(optimisticQueryData, { teamId, isFetching: false });
      }
      onOptimisticApplied?.();
      render?.();
      return { previousQueryData };
    },
    onError: (error, _variables, context) => {
      if (context?.previousQueryData) {
        queryClient.setQueryData(queryKey, context.previousQueryData);
        applyGlossariesQuerySnapshotToState(context.previousQueryData, { teamId, isFetching: false });
      }
      if (typeof render === "function") {
        showNoticeBadge(error?.message ?? String(error), render);
      }
      render?.();
    },
    onSuccess: () => {
      const currentQueryData = queryClient.getQueryData(queryKey);
      const settledQueryData = patchGlossaryQueryData(currentQueryData, glossary.id, settledPatch);
      if (settledQueryData) {
        queryClient.setQueryData(queryKey, settledQueryData);
        applyGlossariesQuerySnapshotToState(settledQueryData, { teamId, isFetching: false });
      }
    },
    onSettled: async () => {
      await invalidateGlossariesQueryAfterMutation(team, { teamId, render });
    },
  };
}

export function createGlossaryRenameMutationOptions({
  team,
  glossary,
  nextTitle,
  commitMutation,
  onOptimisticApplied,
  render,
} = {}) {
  return createGlossaryLifecycleMutationOptions({
    team,
    glossary,
    mutationType: "rename",
    optimisticPatch: {
      title: nextTitle,
      pendingMutation: "rename",
    },
    settledPatch: {
      title: nextTitle,
      pendingMutation: null,
    },
    commitMutation,
    onOptimisticApplied,
    render,
  });
}

export function createGlossarySoftDeleteMutationOptions(options = {}) {
  return createGlossaryLifecycleMutationOptions({
    ...options,
    mutationType: "softDelete",
    optimisticPatch: {
      lifecycleState: "deleted",
      pendingMutation: "softDelete",
    },
    settledPatch: {
      lifecycleState: "deleted",
      pendingMutation: null,
    },
  });
}

export function createGlossaryRestoreMutationOptions(options = {}) {
  return createGlossaryLifecycleMutationOptions({
    ...options,
    mutationType: "restore",
    optimisticPatch: {
      lifecycleState: "active",
      pendingMutation: "restore",
    },
    settledPatch: {
      lifecycleState: "active",
      pendingMutation: null,
    },
  });
}

export async function runGlossaryRenameMutation(options = {}) {
  const observer = createMutationObserver(createGlossaryRenameMutationOptions(options));
  return observer.mutate();
}

export async function runGlossarySoftDeleteMutation(options = {}) {
  const observer = createMutationObserver(createGlossarySoftDeleteMutationOptions(options));
  return observer.mutate();
}

export async function runGlossaryRestoreMutation(options = {}) {
  const observer = createMutationObserver(createGlossaryRestoreMutationOptions(options));
  return observer.mutate();
}
