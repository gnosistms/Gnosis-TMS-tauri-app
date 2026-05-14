import { qaListKeys } from "./query-client.js";
import { loadStoredQaListsForTeam, saveStoredQaListsForTeam } from "./qa-list-cache.js";
import {
  loadRepoBackedQaListsForTeam,
  listLocalQaListsForTeam,
} from "./qa-list-repo-flow.js";
import { normalizeQaList, sortQaLists } from "./qa-list-shared.js";
import { createRepoResourceQueryController } from "./repo-resource/query-controller.js";
import { setResourcePageDataOwner, setResourcePageRefreshing } from "./resource-page-controller.js";
import { createQaListDiscoveryState, state } from "./state.js";
import { teamCacheKey } from "./team-cache.js";
import {
  applyQaListWriteIntentsToSnapshot,
  clearConfirmedQaListWriteIntents,
} from "./qa-list-write-coordinator.js";

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
    brokerWarning: typeof discovery?.brokerWarning === "string" ? discovery.brokerWarning : "",
    recoveryMessage:
      typeof discovery?.recoveryMessage === "string" ? discovery.recoveryMessage : "",
  };
}

export function createQaListsQuerySnapshot({
  qaLists = [],
  syncSnapshots = [],
  syncIssue = "",
  brokerWarning = "",
  recoveryMessage = "",
  error = "",
  status = "ready",
  discovery = {},
} = {}) {
  return {
    qaLists: sortQaLists(
      (Array.isArray(qaLists) ? qaLists : [])
        .map(normalizeQaList)
        .filter(Boolean),
    ),
    repoSyncByRepoName: qaListRepoSyncByRepoName(syncSnapshots),
    syncIssue,
    discovery: createQaListDiscoverySnapshot({
      status,
      brokerWarning,
      recoveryMessage,
      error,
      ...discovery,
    }),
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
    clearConfirmedQaListWriteIntents(snapshot);
    const visibleSnapshot = applyQaListWriteIntentsToSnapshot(snapshot);
    state.qaLists = sortQaLists(
      (Array.isArray(visibleSnapshot?.qaLists) ? visibleSnapshot.qaLists : [])
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

export const preservePendingQaListLifecyclePatches = preserveQaListLifecyclePatchesInSnapshot;

const qaListQueryController = createRepoResourceQueryController({
  kind: "qaList",
  collectionField: "qaLists",
  resourceIdField: "qaListId",
  queryKeyForTeam: qaListKeys.byTeam,
  getSelectedTeamId: () => state.selectedTeamId,
  createSnapshot: createQaListsQuerySnapshot,
  applySnapshotToState: applyQaListsQuerySnapshotToState,
  preserveSnapshot: preserveQaListLifecyclePatchesInSnapshot,
  patchQueryData: patchQaListQueryData,
  loadCacheEntry: loadStoredQaListsForTeam,
  cacheEntryItems: (entry) => entry.qaLists,
  loadLocalItems: listLocalQaListsForTeam,
  canSeedFromLocal: (team) => Number.isFinite(team?.installationId),
  localSnapshotInput: () => ({ discovery: { status: "ready" } }),
  persistSnapshot: (team, snapshot) => saveStoredQaListsForTeam(team, snapshot.qaLists),
  setRefreshing: (isRefreshing) => setResourcePageRefreshing(state.qaListsPage, isRefreshing),
  isRefreshing: () => state.qaListsPage?.isRefreshing === true,
  applyObserverError: (error, { isFetching } = {}) => {
    state.qaListDiscovery = createQaListDiscoverySnapshot({
      status: "error",
      error: error?.message ?? String(error),
    });
    setResourcePageRefreshing(state.qaListsPage, isFetching === true);
  },
  createLifecycleMutationPayload: ({ resource, mutationType, optimisticData }) => {
    const mutation = {
      type: mutationType,
      qaListId: resource.id,
    };
    if (mutationType === "rename") {
      mutation.title = optimisticData.title;
      mutation.previousTitle = resource.title;
    }
    return mutation;
  },
  normalizeMutationResultPatch: (resource, result) =>
    result && typeof result === "object" ? normalizeQaList({ ...resource, ...result }) : null,
  loadRemoteSnapshot: async (team) => {
    const result = await loadRepoBackedQaListsForTeam(team, {
      offlineMode: state.offline?.isEnabled === true,
    });
    const cached = result.qaLists.length > 0 ? null : loadStoredQaListsForTeam(team);
    const qaLists = result.qaLists.length > 0 || !cached?.exists
      ? result.qaLists
      : cached.qaLists;

    return createQaListsQuerySnapshot({
      qaLists,
      syncSnapshots: result.syncSnapshots,
      syncIssue: result.syncIssue,
      brokerWarning: result.brokerWarning,
      recoveryMessage: result.recoveryMessage,
      discovery: { status: "ready" },
    });
  },
});

export function resetQaListsQueryObserver() {
  qaListQueryController.resetObserver();
}

export function seedQaListsQueryFromCache(team, {
  teamId = team?.id,
  render,
} = {}) {
  return qaListQueryController.seedFromCache(team, {
    teamId,
    render,
  });
}

export function createQaListsQueryOptions(team, options = {}) {
  return qaListQueryController.createQueryOptions(team, options);
}

export async function seedQaListsQueryFromLocal(team, {
  teamId = team?.id,
  render,
} = {}) {
  return qaListQueryController.seedFromLocal(team, {
    teamId,
    render,
  });
}

export function ensureQaListsQueryObserver(render, team, options = {}) {
  return qaListQueryController.ensureObserver(render, team, options);
}

export async function invalidateQaListsQueryAfterMutation(team, options = {}) {
  await qaListQueryController.invalidateAfterMutation(team, options);
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
  return qaListQueryController.createLifecycleMutationOptions({
    team,
    resource: qaList,
    mutationType,
    optimisticData,
    settledData,
    commitMutation,
    onOptimisticApplied,
    onSuccessApplied,
    onErrorApplied,
    render,
  });
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
