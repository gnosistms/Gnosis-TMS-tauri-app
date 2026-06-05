import { glossaryKeys } from "./query-client.js";
import {
  loadStoredGlossariesForTeam,
  saveStoredGlossariesForTeam,
} from "./glossary-cache.js";
import {
  listLocalGlossarySummariesForTeam,
  loadRepoBackedGlossariesForTeam,
} from "./glossary-repo-flow.js";
import {
  normalizeGlossarySummary,
  sortGlossaries,
} from "./glossary-shared.js";
import { createRepoResourceQueryController } from "./repo-resource/query-controller.js";
import { setResourcePageDataOwner, setResourcePageRefreshing } from "./resource-page-controller.js";
import { createGlossaryDiscoveryState, state } from "./state.js";
import { teamCacheKey } from "./team-cache.js";
import {
  applyGlossaryWriteIntentsToSnapshot,
  clearConfirmedGlossaryWriteIntents,
} from "./glossary-write-coordinator.js";
import { runTeamResourceMigrationSync } from "./team-resource-migration-flow.js";

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

function normalizeGlossarySummaries(glossaries = []) {
  return sortGlossaries(
    (Array.isArray(glossaries) ? glossaries : [])
      .map((glossary) => normalizeGlossarySummary(glossary))
      .filter(Boolean),
  );
}

function assertUniqueGlossarySummaryIds(glossaries = [], context = "glossary query data") {
  const seen = new Set();
  for (const glossary of Array.isArray(glossaries) ? glossaries : []) {
    const id = typeof glossary?.id === "string" ? glossary.id.trim() : "";
    if (!id) {
      continue;
    }
    if (seen.has(id)) {
      throw new Error(`Duplicate glossary id "${id}" in ${context}.`);
    }
    seen.add(id);
  }
}

function validatedGlossarySummaries(glossaries = [], context = "glossary query data") {
  const summaries = normalizeGlossarySummaries(glossaries);
  assertUniqueGlossarySummaryIds(summaries, context);
  return summaries;
}

function assertUniqueGlossarySnapshotIds(snapshot, context = "glossary query data") {
  assertUniqueGlossarySummaryIds(normalizeGlossariesSnapshotInput(snapshot), context);
}

function createGlossaryDiscoverySnapshot(discovery = {}) {
  return {
    ...createGlossaryDiscoveryState(),
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

export function createGlossariesQuerySnapshot({
  glossaries = [],
  syncSnapshots = [],
  syncIssue = "",
  brokerWarning = "",
  recoveryMessage = "",
  error = "",
  status = "ready",
  discovery = {},
} = {}) {
  return {
    glossaries: validatedGlossarySummaries(glossaries, "glossary query snapshot"),
    repoSyncByRepoName: glossaryRepoSyncByRepoName(syncSnapshots),
    syncIssue,
    discovery: createGlossaryDiscoverySnapshot({
      status,
      brokerWarning: typeof brokerWarning === "string" ? brokerWarning : "",
      recoveryMessage: typeof recoveryMessage === "string" ? recoveryMessage : "",
      error: typeof error === "string" ? error : "",
      ...discovery,
    }),
  };
}

export function applyGlossariesQuerySnapshotToState(snapshot, {
  teamId = state.selectedTeamId,
  isFetching = false,
  cacheKey,
  cacheUpdatedAt = null,
} = {}) {
  if (state.selectedTeamId !== teamId) {
    return false;
  }

  if (snapshot) {
    clearConfirmedGlossaryWriteIntents(snapshot);
    const visibleSnapshot = applyGlossaryWriteIntentsToSnapshot(snapshot);
    state.glossaries = validatedGlossarySummaries(visibleSnapshot?.glossaries, "glossary state snapshot");
    state.glossaryRepoSyncByRepoName =
      snapshot.repoSyncByRepoName && typeof snapshot.repoSyncByRepoName === "object"
        ? snapshot.repoSyncByRepoName
        : {};
    state.glossaryDiscovery = createGlossaryDiscoverySnapshot(snapshot.discovery);
    const team = state.teams.find((item) => item?.id === teamId);
    setResourcePageDataOwner(state.glossariesPage, {
      teamId,
      cacheKey: cacheKey ?? teamCacheKey(team),
      cacheUpdatedAt,
    });
    if (!state.glossaries.some((glossary) => glossary.lifecycleState === "deleted")) {
      state.showDeletedGlossaries = false;
    }
  }

  setResourcePageRefreshing(state.glossariesPage, isFetching === true);
  return true;
}

export function patchGlossaryQueryData(queryData, glossaryId, patch) {
  if (!queryData || typeof queryData !== "object") {
    return queryData;
  }

  let changed = false;
  const currentGlossaries = Array.isArray(queryData.glossaries) ? queryData.glossaries : [];
  assertUniqueGlossarySummaryIds(currentGlossaries, "glossary query patch input");
  const nextGlossaries = currentGlossaries.map((glossary) => {
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
      glossaries: validatedGlossarySummaries(nextGlossaries, "glossary query patch result"),
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
  assertUniqueGlossarySummaryIds(currentGlossaries, "glossary lifecycle patch input");
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
  return validatedGlossarySummaries(patchedGlossaries, "glossary lifecycle patch result");
}

export function preserveGlossaryLifecyclePatchesInSnapshot(nextSnapshot, previousSnapshot) {
  if (!nextSnapshot || typeof nextSnapshot !== "object") {
    return nextSnapshot;
  }

  const previousGlossaries = normalizeGlossariesSnapshotInput(previousSnapshot);
  assertUniqueGlossarySummaryIds(previousGlossaries, "previous glossary lifecycle snapshot");
  const intentById = new Map(
    previousGlossaries
      .filter((glossary) => typeof glossary?.id === "string" && glossaryLifecycleIntent(glossary))
      .map((glossary) => [glossary.id, glossary]),
  );
  if (intentById.size === 0) {
    return nextSnapshot;
  }

  let nextGlossaries = normalizeGlossariesSnapshotInput(nextSnapshot);
  assertUniqueGlossarySummaryIds(nextGlossaries, "next glossary lifecycle snapshot");
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
    glossaries: validatedGlossarySummaries(nextGlossaries, "preserved glossary lifecycle snapshot"),
  };
}

export function preservePendingGlossaryLifecyclePatches(nextSnapshot, previousSnapshot) {
  return preserveGlossaryLifecyclePatchesInSnapshot(nextSnapshot, previousSnapshot);
}

const glossaryQueryController = createRepoResourceQueryController({
  kind: "glossary",
  collectionField: "glossaries",
  resourceIdField: "glossaryId",
  queryKeyForTeam: glossaryKeys.byTeam,
  getSelectedTeamId: () => state.selectedTeamId,
  createSnapshot: createGlossariesQuerySnapshot,
  applySnapshotToState: applyGlossariesQuerySnapshotToState,
  preserveSnapshot: preserveGlossaryLifecyclePatchesInSnapshot,
  validateSnapshot: assertUniqueGlossarySnapshotIds,
  patchQueryData: patchGlossaryQueryData,
  loadCacheEntry: loadStoredGlossariesForTeam,
  cacheEntryItems: (entry) => entry.glossaries,
  loadLocalItems: listLocalGlossarySummariesForTeam,
  localSnapshotInput: () => ({ discovery: { status: "ready" } }),
  persistSnapshot: (team, snapshot) => saveStoredGlossariesForTeam(team, snapshot.glossaries),
  setRefreshing: (isRefreshing) => setResourcePageRefreshing(state.glossariesPage, isRefreshing),
  isRefreshing: () => state.glossariesPage?.isRefreshing === true,
  applyObserverError: (error, { isFetching } = {}) => {
    state.glossaryDiscovery = createGlossaryDiscoverySnapshot({
      status: "error",
      error: error?.message ?? String(error),
    });
    setResourcePageRefreshing(state.glossariesPage, isFetching === true);
  },
  createLifecycleMutationPayload: ({ resource, mutationType, optimisticData }) => {
    const mutation = {
      type: mutationType,
      resourceId: resource.id,
      glossaryId: resource.id,
    };
    if (mutationType === "rename") {
      mutation.title = optimisticData.title;
      mutation.previousTitle = resource.title;
    }
    return mutation;
  },
  loadRemoteSnapshot: async (team, options = {}) => {
    const teamId = options.teamId ?? team?.id ?? null;
    await runTeamResourceMigrationSync(options.render, team);
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

    return createGlossariesQuerySnapshot({
      glossaries: nextGlossaries,
      syncSnapshots,
      syncIssue,
      brokerWarning,
      recoveryMessage,
      status: "ready",
    });
  },
});

export function resetGlossariesQueryObserver() {
  glossaryQueryController.resetObserver();
}

export function seedGlossariesQueryFromCache(team, {
  teamId = team?.id,
  loadStoredGlossariesForTeam,
  render,
} = {}) {
  return glossaryQueryController.seedFromCache(team, {
    teamId,
    loadCacheEntry: loadStoredGlossariesForTeam,
    render,
  });
}

export async function seedGlossariesQueryFromLocal(team, {
  teamId = team?.id,
  render,
  persist = true,
} = {}) {
  return glossaryQueryController.seedFromLocal(team, {
    teamId,
    render,
    persist,
  });
}

export function createGlossariesQueryOptions(team, options = {}) {
  return glossaryQueryController.createQueryOptions(team, options);
}

export function ensureGlossariesQueryObserver(render, team, options = {}) {
  return glossaryQueryController.ensureObserver(render, team, options);
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
  return glossaryQueryController.createLifecycleMutationOptions({
    team,
    resource: glossary,
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
  return glossaryQueryController.createLifecycleMutationOptions({
    ...options,
    resource: options.glossary,
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
  return glossaryQueryController.createLifecycleMutationOptions({
    ...options,
    resource: options.glossary,
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
  return glossaryQueryController.createLifecycleMutationOptions({
    ...options,
    resource: options.glossary,
    mutationType: "permanentDelete",
  });
}

export async function invalidateGlossariesQueryAfterMutation(team, options = {}) {
  await glossaryQueryController.invalidateAfterMutation(team, options);
}

export function persistGlossariesQueryDataForTeam(team, queryData) {
  if (!team || !queryData) {
    return;
  }
  saveStoredGlossariesForTeam(team, Array.isArray(queryData.glossaries) ? queryData.glossaries : []);
}
