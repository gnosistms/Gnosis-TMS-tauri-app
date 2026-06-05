import { glossaryKeys } from "./query-client.js";
import {
  loadStoredGlossariesForTeam,
  saveStoredGlossariesForTeam,
} from "./glossary-cache.js";
import {
  loadRepoBackedGlossariesForTeam,
  listLocalGlossarySummariesForTeam,
} from "./glossary-repo-flow.js";
import {
  normalizeGlossarySummary,
  sortGlossaries,
} from "./glossary-shared.js";
import {
  createRepoResourceDiscoverySnapshot,
  createRepoResourceQueryController,
  repoSyncByRepoName,
} from "./repo-resource/query-controller.js";
import { setResourcePageDataOwner, setResourcePageRefreshing } from "./resource-page-controller.js";
import { createGlossaryDiscoveryState, state } from "./state.js";
import { teamCacheKey } from "./team-cache.js";
import {
  applyGlossaryWriteIntentsToSnapshot,
  clearConfirmedGlossaryWriteIntents,
} from "./glossary-write-coordinator.js";
import { runTeamResourceMigrationSync } from "./team-resource-migration-flow.js";

// Residue: glossary snapshot shaping stays local because normalization/sorting is term-model specific.
function normalizeGlossaries(glossaries = []) {
  return sortGlossaries(
    (Array.isArray(glossaries) ? glossaries : [])
      .map((glossary) => normalizeGlossarySummary(glossary))
      .filter(Boolean),
  );
}

function assertUniqueGlossaryIds(glossaries = [], context = "glossary query data") {
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

function validatedGlossaries(glossaries = [], context = "glossary query data") {
  const normalized = normalizeGlossaries(glossaries);
  assertUniqueGlossaryIds(normalized, context);
  return normalized;
}

function assertUniqueGlossarySnapshotIds(snapshot, context = "glossary query data") {
  assertUniqueGlossaryIds(Array.isArray(snapshot?.glossaries) ? snapshot.glossaries : [], context);
}

function createGlossaryDiscoverySnapshot(discovery = {}) {
  return createRepoResourceDiscoverySnapshot(createGlossaryDiscoveryState, discovery);
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
    glossaries: validatedGlossaries(glossaries, "glossary query snapshot"),
    repoSyncByRepoName: repoSyncByRepoName(syncSnapshots),
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
  // Residue: R3 state application and cache ownership are intentionally per-domain.
  if (state.selectedTeamId !== teamId) {
    return false;
  }

  if (snapshot) {
    clearConfirmedGlossaryWriteIntents(snapshot);
    const visibleSnapshot = applyGlossaryWriteIntentsToSnapshot(snapshot);
    state.glossaries = validatedGlossaries(visibleSnapshot?.glossaries, "glossary state snapshot");
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
  assertUniqueGlossaryIds(currentGlossaries, "glossary query patch input");
  const glossaries = currentGlossaries
    .map((glossary) => {
      if (glossary?.id !== glossaryId) {
        return glossary;
      }
      changed = true;
      return normalizeGlossarySummary({
        ...glossary,
        ...patch,
      });
    })
    .filter(Boolean);

  return changed
    ? {
      ...queryData,
      glossaries: validatedGlossaries(glossaries, "glossary query patch result"),
    }
    : queryData;
}

export function upsertGlossaryQueryData(queryData, glossary) {
  // Residue: Q-FEAT-2 create preservation uses the domain normalizer and snapshot factory.
  if (!queryData || typeof queryData !== "object") {
    return createGlossariesQuerySnapshot({ glossaries: [glossary] });
  }
  const normalized = normalizeGlossarySummary(glossary);
  if (!normalized) {
    return queryData;
  }
  const glossaries = Array.isArray(queryData.glossaries) ? queryData.glossaries : [];
  assertUniqueGlossaryIds(glossaries, "glossary query upsert input");
  const exists = glossaries.some((item) => item?.id === normalized.id);
  return {
    ...queryData,
    glossaries: validatedGlossaries(
      exists
        ? glossaries.map((item) => (item?.id === normalized.id ? normalized : item))
        : [...glossaries, normalized],
      "glossary query upsert result",
    ),
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
  return (Array.isArray(snapshot?.glossaries) ? snapshot.glossaries : [])
    .find((glossary) => glossary?.id === glossaryId) ?? null;
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
  assertUniqueGlossaryIds(currentGlossaries, "glossary lifecycle patch input");
  let found = false;
  const patchedGlossaries = currentGlossaries.map((glossary) => {
    if (glossary?.id !== glossaryId) {
      return glossary;
    }
    found = true;
    return normalizeGlossarySummary({
      ...glossary,
      ...patch,
    });
  });
  if (!found && fallbackGlossary) {
    patchedGlossaries.push(normalizeGlossarySummary({
      ...fallbackGlossary,
      ...patch,
    }));
  }
  return validatedGlossaries(patchedGlossaries, "glossary lifecycle patch result");
}

export function preserveGlossaryLifecyclePatchesInSnapshot(nextSnapshot, previousSnapshot) {
  // Residue: pending create/upsert preservation stays local until import-flow create callers converge.
  if (!nextSnapshot || typeof nextSnapshot !== "object") {
    return nextSnapshot;
  }

  const previousGlossaries = Array.isArray(previousSnapshot?.glossaries) ? previousSnapshot.glossaries : [];
  assertUniqueGlossaryIds(previousGlossaries, "previous glossary lifecycle snapshot");
  const intentById = new Map(
    previousGlossaries
      .filter((glossary) => typeof glossary?.id === "string" && glossaryLifecycleIntent(glossary))
      .map((glossary) => [glossary.id, glossary]),
  );
  if (intentById.size === 0) {
    return nextSnapshot;
  }

  let nextGlossaries = Array.isArray(nextSnapshot.glossaries) ? nextSnapshot.glossaries : [];
  assertUniqueGlossaryIds(nextGlossaries, "next glossary lifecycle snapshot");
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
      continue;
    }

    if (intent === "create") {
      if (glossaryInSnapshot({ glossaries: nextGlossaries }, previousGlossary.id)) {
        continue;
      }
      nextGlossaries = patchGlossaryInList(nextGlossaries, previousGlossary.id, {
        lifecycleState: "active",
        pendingMutation: isPending ? "create" : null,
        localLifecycleIntent: "create",
      }, previousGlossary);
    }
  }

  return {
    ...nextSnapshot,
    glossaries: validatedGlossaries(nextGlossaries, "preserved glossary lifecycle snapshot"),
  };
}

export const preservePendingGlossaryLifecyclePatches = preserveGlossaryLifecyclePatchesInSnapshot;

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
  loadLocalItems: listLocalGlossarySummariesForTeam,
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

export async function invalidateGlossariesQueryAfterMutation(team, options = {}) {
  await glossaryQueryController.invalidateAfterMutation(team, options);
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
  return glossaryQueryController.createLifecycleMutationOptions({
    team,
    resource: glossary,
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

export function persistGlossariesQueryDataForTeam(team, queryData) {
  if (!team || !queryData) {
    return;
  }
  saveStoredGlossariesForTeam(team, Array.isArray(queryData.glossaries) ? queryData.glossaries : []);
}
