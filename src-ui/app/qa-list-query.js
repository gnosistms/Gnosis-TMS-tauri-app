import { qaListKeys, queryClient, subscribeQueryObserver } from "./query-client.js";
import { loadStoredQaListsForTeam, saveStoredQaListsForTeam } from "./qa-list-cache.js";
import {
  listLocalQaListsForTeam,
  listRemoteQaListReposForTeam,
  syncQaListReposForTeam,
  teamSupportsQaListRepos,
} from "./qa-list-repo-flow.js";
import { normalizeQaList, sortQaLists } from "./qa-list-shared.js";
import { setResourcePageDataOwner, setResourcePageRefreshing } from "./resource-page-controller.js";
import { createQaListDiscoveryState, state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import { teamCacheKey } from "./team-cache.js";

let activeQaListsQuerySubscription = null;

export function resetQaListsQueryObserver() {
  activeQaListsQuerySubscription?.unsubscribe?.();
  activeQaListsQuerySubscription?.observer?.destroy?.();
  activeQaListsQuerySubscription = null;
}

function qaListRepoSyncByRepoName(syncSnapshots = []) {
  return Object.fromEntries(
    (Array.isArray(syncSnapshots) ? syncSnapshots : [])
      .map((snapshot) => [
        typeof snapshot?.repoName === "string" ? snapshot.repoName : "",
        snapshot,
      ])
      .filter(([repoName]) => repoName),
  );
}

function createQaListDiscoverySnapshot(discovery = {}) {
  return {
    ...createQaListDiscoveryState(),
    status:
      typeof discovery?.status === "string" && discovery.status.trim()
        ? discovery.status.trim()
        : "ready",
    error: typeof discovery?.error === "string" ? discovery.error : "",
    recoveryMessage:
      typeof discovery?.recoveryMessage === "string" ? discovery.recoveryMessage : "",
  };
}

function mergeQaListRepoMetadata(localQaLists, remoteRepos) {
  const remoteByName = new Map(
    (Array.isArray(remoteRepos) ? remoteRepos : [])
      .filter((repo) => typeof repo?.name === "string" && repo.name.trim())
      .map((repo) => [repo.name, repo]),
  );

  return sortQaLists(
    (Array.isArray(localQaLists) ? localQaLists : [])
      .map((qaList) => {
        const remote = remoteByName.get(qaList.repoName);
        return normalizeQaList({
          ...qaList,
          repoId: remote?.repoId ?? qaList.repoId ?? null,
          nodeId: remote?.nodeId ?? qaList.nodeId ?? null,
          fullName: remote?.fullName ?? qaList.fullName ?? null,
          htmlUrl: remote?.htmlUrl ?? qaList.htmlUrl ?? "",
          defaultBranchName: remote?.defaultBranchName ?? qaList.defaultBranchName ?? "main",
          defaultBranchHeadOid: remote?.defaultBranchHeadOid ?? qaList.defaultBranchHeadOid ?? null,
        });
      })
      .filter(Boolean),
  );
}

export function createQaListsQuerySnapshot({
  qaLists = [],
  syncSnapshots = [],
  discovery = {},
} = {}) {
  return {
    qaLists: sortQaLists(
      (Array.isArray(qaLists) ? qaLists : [])
        .map(normalizeQaList)
        .filter(Boolean),
    ),
    repoSyncByRepoName: qaListRepoSyncByRepoName(syncSnapshots),
    discovery: createQaListDiscoverySnapshot(discovery),
  };
}

export function applyQaListsQuerySnapshotToState(snapshot, {
  teamId = state.selectedTeamId,
  isFetching = false,
  cacheKey,
  cacheUpdatedAt = null,
} = {}) {
  if (state.selectedTeamId !== teamId) {
    return false;
  }

  if (snapshot) {
    state.qaLists = sortQaLists(
      (Array.isArray(snapshot.qaLists) ? snapshot.qaLists : [])
        .map(normalizeQaList)
        .filter(Boolean),
    );
    state.qaListRepoSyncByRepoName =
      snapshot.repoSyncByRepoName && typeof snapshot.repoSyncByRepoName === "object"
        ? snapshot.repoSyncByRepoName
        : {};
    state.qaListDiscovery = createQaListDiscoverySnapshot(snapshot.discovery);
    const team = state.teams.find((item) => item?.id === teamId);
    setResourcePageDataOwner(state.qaListsPage, {
      teamId,
      cacheKey: cacheKey ?? teamCacheKey(team),
      cacheUpdatedAt,
    });
    if (!state.qaLists.some((qaList) => qaList.lifecycleState === "deleted")) {
      state.showDeletedQaLists = false;
    }
  }

  setResourcePageRefreshing(state.qaListsPage, isFetching === true);
  return true;
}

export function patchQaListQueryData(queryData, qaListId, patch) {
  if (!queryData || typeof queryData !== "object") {
    return queryData;
  }

  let changed = false;
  const qaLists = (Array.isArray(queryData.qaLists) ? queryData.qaLists : [])
    .map((qaList) => {
      if (qaList?.id !== qaListId) {
        return qaList;
      }
      changed = true;
      return normalizeQaList({
        ...qaList,
        ...patch,
      });
    })
    .filter(Boolean);

  return changed
    ? {
      ...queryData,
      qaLists: sortQaLists(qaLists),
    }
    : queryData;
}

export function upsertQaListQueryData(queryData, qaList) {
  if (!queryData || typeof queryData !== "object") {
    return createQaListsQuerySnapshot({ qaLists: [qaList] });
  }
  const normalized = normalizeQaList(qaList);
  if (!normalized) {
    return queryData;
  }
  const qaLists = Array.isArray(queryData.qaLists) ? queryData.qaLists : [];
  const exists = qaLists.some((item) => item?.id === normalized.id);
  return {
    ...queryData,
    qaLists: sortQaLists(
      (exists
        ? qaLists.map((item) => (item?.id === normalized.id ? normalized : item))
        : [...qaLists, normalized])
        .map(normalizeQaList)
        .filter(Boolean),
    ),
  };
}

function removeQaListFromQueryData(queryData, qaListId) {
  if (!queryData || typeof queryData !== "object") {
    return queryData;
  }
  const qaLists = Array.isArray(queryData.qaLists) ? queryData.qaLists : [];
  const nextQaLists = qaLists.filter((qaList) => qaList?.id !== qaListId);
  return nextQaLists.length === qaLists.length
    ? queryData
    : {
      ...queryData,
      qaLists: nextQaLists,
    };
}

function qaListLifecycleIntent(qaList) {
  if (typeof qaList?.pendingMutation === "string" && qaList.pendingMutation.trim()) {
    return qaList.pendingMutation.trim();
  }
  if (typeof qaList?.localLifecycleIntent === "string" && qaList.localLifecycleIntent.trim()) {
    return qaList.localLifecycleIntent.trim();
  }
  return "";
}

function qaListInSnapshot(snapshot, qaListId) {
  return (Array.isArray(snapshot?.qaLists) ? snapshot.qaLists : [])
    .find((qaList) => qaList?.id === qaListId) ?? null;
}

function qaListLocation(snapshot, qaListId) {
  const qaList = qaListInSnapshot(snapshot, qaListId);
  if (!qaList) {
    return "";
  }
  return qaList.lifecycleState === "deleted" ? "deleted" : "active";
}

function qaListTitleInSnapshot(snapshot, qaListId) {
  return qaListInSnapshot(snapshot, qaListId)?.title;
}

function patchQaListInList(qaLists, qaListId, patch, fallbackQaList = null) {
  const currentQaLists = Array.isArray(qaLists) ? qaLists : [];
  let found = false;
  const patchedQaLists = currentQaLists.map((qaList) => {
    if (qaList?.id !== qaListId) {
      return qaList;
    }
    found = true;
    return normalizeQaList({
      ...qaList,
      ...patch,
    });
  });
  if (!found && fallbackQaList) {
    patchedQaLists.push(normalizeQaList({
      ...fallbackQaList,
      ...patch,
    }));
  }
  return sortQaLists(patchedQaLists.filter(Boolean));
}

export function preserveQaListLifecyclePatchesInSnapshot(nextSnapshot, previousSnapshot) {
  if (!nextSnapshot || typeof nextSnapshot !== "object") {
    return nextSnapshot;
  }

  const previousQaLists = Array.isArray(previousSnapshot?.qaLists) ? previousSnapshot.qaLists : [];
  const intentById = new Map(
    previousQaLists
      .filter((qaList) => typeof qaList?.id === "string" && qaListLifecycleIntent(qaList))
      .map((qaList) => [qaList.id, qaList]),
  );
  if (intentById.size === 0) {
    return nextSnapshot;
  }

  let nextQaLists = Array.isArray(nextSnapshot.qaLists) ? nextSnapshot.qaLists : [];
  for (const previousQaList of intentById.values()) {
    const intent = qaListLifecycleIntent(previousQaList);
    const isPending = typeof previousQaList?.pendingMutation === "string"
      && previousQaList.pendingMutation.trim();

    if (intent === "softDelete") {
      if (!isPending && qaListLocation({ qaLists: nextQaLists }, previousQaList.id) === "deleted") {
        continue;
      }
      nextQaLists = patchQaListInList(nextQaLists, previousQaList.id, {
        lifecycleState: "deleted",
        pendingMutation: isPending ? "softDelete" : null,
        localLifecycleIntent: "softDelete",
      }, previousQaList);
      continue;
    }

    if (intent === "restore") {
      if (!isPending && qaListLocation({ qaLists: nextQaLists }, previousQaList.id) === "active") {
        continue;
      }
      nextQaLists = patchQaListInList(nextQaLists, previousQaList.id, {
        lifecycleState: "active",
        pendingMutation: isPending ? "restore" : null,
        localLifecycleIntent: "restore",
      }, previousQaList);
      continue;
    }

    if (intent === "rename") {
      if (!isPending && qaListTitleInSnapshot({ qaLists: nextQaLists }, previousQaList.id) === previousQaList.title) {
        continue;
      }
      nextQaLists = patchQaListInList(nextQaLists, previousQaList.id, {
        title: previousQaList.title,
        pendingMutation: isPending ? "rename" : null,
        localLifecycleIntent: "rename",
      }, previousQaList);
      continue;
    }

    if (intent === "create") {
      if (qaListInSnapshot({ qaLists: nextQaLists }, previousQaList.id)) {
        continue;
      }
      nextQaLists = patchQaListInList(nextQaLists, previousQaList.id, {
        lifecycleState: "active",
        pendingMutation: isPending ? "create" : null,
        localLifecycleIntent: "create",
      }, previousQaList);
    }
  }

  return {
    ...nextSnapshot,
    qaLists: nextQaLists,
  };
}

function moveQaListToLifecycle(queryData, qaListId, lifecycleState, patch = {}) {
  return patchQaListQueryData(queryData, qaListId, {
    ...patch,
    lifecycleState,
  });
}

export function seedQaListsQueryFromCache(team, {
  teamId = team?.id,
  render,
} = {}) {
  const expectedCacheKey = teamCacheKey(team);
  const cachedQaLists = loadStoredQaListsForTeam(team);
  if (
    state.selectedTeamId !== teamId
    || !cachedQaLists?.exists
    || cachedQaLists.cacheKey !== expectedCacheKey
  ) {
    return null;
  }

  const queryKey = qaListKeys.byTeam(teamId);
  const previousQueryData = queryClient.getQueryData(queryKey);
  const snapshot = preserveQaListLifecyclePatchesInSnapshot(
    createQaListsQuerySnapshot({
      qaLists: cachedQaLists.qaLists,
      discovery: { status: "ready" },
    }),
    previousQueryData,
  );
  queryClient.setQueryData(queryKey, snapshot);
  applyQaListsQuerySnapshotToState(snapshot, {
    teamId,
    isFetching: true,
    cacheKey: expectedCacheKey,
    cacheUpdatedAt: cachedQaLists.updatedAt,
  });
  render?.();
  return snapshot;
}

export function createQaListsQueryOptions(team, options = {}) {
  const teamId = options.teamId ?? team?.id ?? null;
  return {
    queryKey: qaListKeys.byTeam(teamId),
    queryFn: async () => {
      let qaLists = [];
      let syncSnapshots = [];

      if (teamSupportsQaListRepos(team)) {
        const remoteRepos = await listRemoteQaListReposForTeam(team);
        syncSnapshots = await syncQaListReposForTeam(team, remoteRepos);
        const localQaLists = await listLocalQaListsForTeam(team);
        qaLists = mergeQaListRepoMetadata(localQaLists, remoteRepos);
      } else {
        const cached = loadStoredQaListsForTeam(team);
        qaLists = cached.exists ? cached.qaLists : [];
      }

      const nextSnapshot = createQaListsQuerySnapshot({
        qaLists,
        syncSnapshots,
        discovery: { status: "ready" },
      });
      return preserveQaListLifecyclePatchesInSnapshot(
        nextSnapshot,
        queryClient.getQueryData(qaListKeys.byTeam(teamId)),
      );
    },
  };
}

export function ensureQaListsQueryObserver(render, team, options = {}) {
  const teamId = options.teamId ?? team?.id ?? null;
  const queryKey = qaListKeys.byTeam(teamId);
  const currentKey = JSON.stringify(queryKey);
  if (activeQaListsQuerySubscription?.key === currentKey) {
    activeQaListsQuerySubscription.observer?.setOptions?.(
      createQaListsQueryOptions(team, {
        ...options,
        teamId,
      }),
    );
    return activeQaListsQuerySubscription;
  }

  activeQaListsQuerySubscription?.unsubscribe?.();
  const subscription = subscribeQueryObserver(
    createQaListsQueryOptions(team, {
      ...options,
      teamId,
    }),
    (result) => {
      if (result.data) {
        applyQaListsQuerySnapshotToState(result.data, {
          teamId,
          isFetching: result.isFetching,
        });
      } else if (result.error && state.selectedTeamId === teamId) {
        state.qaListDiscovery = createQaListDiscoverySnapshot({
          status: "error",
          error: result.error?.message ?? String(result.error),
        });
        setResourcePageRefreshing(state.qaListsPage, result.isFetching === true);
      } else if (state.selectedTeamId === teamId) {
        setResourcePageRefreshing(state.qaListsPage, result.isFetching === true);
      }
      render?.();
    },
  );

  activeQaListsQuerySubscription = {
    ...subscription,
    key: currentKey,
    teamId,
  };
  return activeQaListsQuerySubscription;
}

export async function invalidateQaListsQueryAfterMutation(team, options = {}) {
  const teamId = options.teamId ?? team?.id ?? null;
  const queryKey = qaListKeys.byTeam(teamId);
  const query = queryClient.getQueryCache().find({ queryKey });
  const hasActiveObserver = typeof query?.getObserversCount === "function"
    ? query.getObserversCount() > 0
    : false;

  await queryClient.invalidateQueries({
    queryKey,
    refetchType: hasActiveObserver ? "active" : "none",
  });

  if (!hasActiveObserver && options.refetchIfInactive !== false) {
    await queryClient.fetchQuery(createQaListsQueryOptions(team, {
      ...options,
      teamId,
    }));
  }
}

function createQaListLifecycleMutationOptions({
  team,
  qaList,
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
  const queryKey = qaListKeys.byTeam(teamId);
  return {
    mutationKey: ["qaList", mutationType, qaList?.id ?? null],
    scope: { id: `team-metadata:${team?.installationId ?? "unknown"}` },
    mutationFn: async () => {
      if (typeof commitMutation !== "function") {
        return null;
      }
      const mutation = {
        type: mutationType,
        qaListId: qaList.id,
      };
      if (mutationType === "rename") {
        mutation.title = optimisticData.title;
        mutation.previousTitle = qaList.title;
      }
      return commitMutation(team, mutation);
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey });
      const previousQueryData = queryClient.getQueryData(queryKey);
      let optimisticQueryData = previousQueryData;
      if (mutationType === "softDelete") {
        optimisticQueryData = moveQaListToLifecycle(previousQueryData, qaList.id, "deleted", optimisticData);
      } else if (mutationType === "restore") {
        optimisticQueryData = moveQaListToLifecycle(previousQueryData, qaList.id, "active", optimisticData);
      } else if (mutationType === "permanentDelete") {
        optimisticQueryData = removeQaListFromQueryData(previousQueryData, qaList.id);
      } else {
        optimisticQueryData = patchQaListQueryData(previousQueryData, qaList.id, optimisticData);
      }
      if (optimisticQueryData) {
        queryClient.setQueryData(queryKey, optimisticQueryData);
        applyQaListsQuerySnapshotToState(optimisticQueryData, {
          teamId,
          isFetching: state.qaListsPage?.isRefreshing === true,
        });
      }
      onOptimisticApplied?.(optimisticQueryData);
      render?.();
      return { previousQueryData };
    },
    onError: (error, _variables, context) => {
      if (context?.previousQueryData) {
        queryClient.setQueryData(queryKey, context.previousQueryData);
        applyQaListsQuerySnapshotToState(context.previousQueryData, {
          teamId,
          isFetching: state.qaListsPage?.isRefreshing === true,
        });
      }
      onErrorApplied?.(error, context);
      if (typeof render === "function") {
        showNoticeBadge(error?.message ?? String(error), render);
      }
      render?.();
    },
    onSuccess: (result) => {
      const currentQueryData = queryClient.getQueryData(queryKey);
      const resultPatch = result && typeof result === "object" ? normalizeQaList({ ...qaList, ...result }) : null;
      let settledQueryData = currentQueryData;
      if (mutationType === "softDelete") {
        settledQueryData = moveQaListToLifecycle(currentQueryData, qaList.id, "deleted", {
          ...settledData,
          ...(resultPatch ?? {}),
          lifecycleState: "deleted",
        });
      } else if (mutationType === "restore") {
        settledQueryData = moveQaListToLifecycle(currentQueryData, qaList.id, "active", {
          ...settledData,
          ...(resultPatch ?? {}),
          lifecycleState: "active",
        });
      } else if (mutationType === "permanentDelete") {
        settledQueryData = removeQaListFromQueryData(currentQueryData, qaList.id);
      } else {
        settledQueryData = patchQaListQueryData(currentQueryData, qaList.id, {
          ...settledData,
          ...(resultPatch ?? {}),
        });
      }
      if (settledQueryData) {
        queryClient.setQueryData(queryKey, settledQueryData);
        applyQaListsQuerySnapshotToState(settledQueryData, {
          teamId,
          isFetching: state.qaListsPage?.isRefreshing === true,
        });
      }
      onSuccessApplied?.(settledQueryData, result);
      render?.();
    },
    onSettled: async () => {
      await invalidateQaListsQueryAfterMutation(team, {
        teamId,
        render,
        refetchIfInactive: false,
      });
    },
  };
}

export function createQaListRenameMutationOptions({
  team,
  qaList,
  nextTitle,
  commitMutation,
  onOptimisticApplied,
  onSuccessApplied,
  onErrorApplied,
  render,
} = {}) {
  return createQaListLifecycleMutationOptions({
    team,
    qaList,
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

export function createQaListSoftDeleteMutationOptions(options = {}) {
  return createQaListLifecycleMutationOptions({
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

export function createQaListRestoreMutationOptions(options = {}) {
  return createQaListLifecycleMutationOptions({
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

export function createQaListPermanentDeleteMutationOptions(options = {}) {
  return createQaListLifecycleMutationOptions({
    ...options,
    mutationType: "permanentDelete",
  });
}

export function persistQaListsQueryDataForTeam(team, queryData) {
  if (!team || !queryData) {
    return;
  }
  saveStoredQaListsForTeam(team, Array.isArray(queryData.qaLists) ? queryData.qaLists : []);
}
