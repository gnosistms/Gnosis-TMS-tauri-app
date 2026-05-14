import test from "node:test";
import assert from "node:assert/strict";

globalThis.document = globalThis.document ?? {
  querySelector: () => null,
};
globalThis.window = globalThis.window ?? {
  __TAURI__: {},
  requestAnimationFrame: (callback) => setTimeout(callback, 0),
};

const { createRepoResourceQueryController } = await import("./repo-resource/query-controller.js");
const { queryClient } = await import("./query-client.js");
const { teamCacheKey } = await import("./team-cache.js");

function fakeResource(overrides = {}) {
  return {
    id: "resource-1",
    title: "Original",
    lifecycleState: "active",
    ...overrides,
  };
}

function createHarness(overrides = {}) {
  const harness = {
    selectedTeamId: "team-1",
    visibleItems: [],
    appliedSnapshots: [],
    refreshing: false,
    localItems: [fakeResource({ title: "Local" })],
    remoteSnapshot: null,
    cacheEntry: null,
    renderCount: 0,
    badgeMessages: [],
    capabilityTouched: false,
  };
  Object.assign(harness, overrides);

  const controller = createRepoResourceQueryController({
    kind: "fakeResource",
    collectionField: "resources",
    resourceIdField: "resourceId",
    queryKeyForTeam: (teamId) => ["fakeResources", teamId ?? null],
    getSelectedTeamId: () => harness.selectedTeamId,
    createSnapshot: ({ resources = [], status = "ready" } = {}) => ({
      resources,
      discovery: { status },
    }),
    applySnapshotToState: (snapshot, { teamId, isFetching = false, cacheKey = null } = {}) => {
      if (harness.selectedTeamId !== teamId) {
        return false;
      }
      harness.visibleItems = Array.isArray(snapshot?.resources) ? snapshot.resources : [];
      harness.appliedSnapshots.push({ snapshot, teamId, isFetching, cacheKey });
      harness.refreshing = isFetching === true;
      return true;
    },
    setRefreshing: (isRefreshing) => {
      harness.refreshing = isRefreshing === true;
    },
    loadCacheEntry: () => harness.cacheEntry,
    cacheEntryItems: (entry) => entry.resources,
    loadLocalItems: async () => harness.localItems,
    loadRemoteSnapshot: async (_team, { teamId }) => {
      if (harness.remoteDelay) {
        await harness.remoteDelay;
      }
      if (harness.selectedTeamId !== teamId) {
        return null;
      }
      return harness.remoteSnapshot ?? {
        resources: [fakeResource({ title: "Remote" })],
        discovery: { status: "ready" },
      };
    },
    preserveSnapshot: (nextSnapshot, previousSnapshot) => {
      if (!nextSnapshot || !previousSnapshot) {
        return nextSnapshot;
      }
      const previousById = new Map(
        (Array.isArray(previousSnapshot.resources) ? previousSnapshot.resources : [])
          .map((item) => [item.id, item]),
      );
      return {
        ...nextSnapshot,
        resources: (Array.isArray(nextSnapshot.resources) ? nextSnapshot.resources : []).map((item) => {
          const previous = previousById.get(item.id);
          return previous?.pendingMutation ? previous : item;
        }),
      };
    },
    patchQueryData: (queryData, resourceId, patch) => ({
      ...queryData,
      resources: (Array.isArray(queryData?.resources) ? queryData.resources : []).map((item) =>
        item.id === resourceId ? { ...item, ...patch } : item
      ),
    }),
    isRefreshing: () => harness.refreshing,
    showNoticeBadge: (message) => {
      harness.badgeMessages.push(message);
    },
    capabilities: null,
  });

  return {
    harness,
    controller,
    team: { id: "team-1", installationId: 1 },
    render: () => {
      harness.renderCount += 1;
    },
  };
}

test.afterEach(() => {
  queryClient.clear();
});

test("repo resource cache seed ignores mismatched cache keys", () => {
  const { controller, harness, team } = createHarness({
    cacheEntry: {
      exists: true,
      cacheKey: "team:other",
      resources: [fakeResource({ title: "Wrong cache" })],
    },
  });

  const snapshot = controller.seedFromCache(team);

  assert.equal(snapshot, null);
  assert.equal(harness.visibleItems.length, 0);
  assert.equal(queryClient.getQueryData(["fakeResources", "team-1"]), undefined);
});

test("repo resource cache seed applies matching cache through snapshot path", () => {
  const { controller, harness, team } = createHarness({
    cacheEntry: {
      exists: true,
      cacheKey: teamCacheKey({ id: "team-1", installationId: 1 }),
      updatedAt: "2026-05-14T00:00:00.000Z",
      resources: [fakeResource({ title: "Cached" })],
    },
  });

  const snapshot = controller.seedFromCache(team);

  assert.equal(snapshot.resources[0].title, "Cached");
  assert.equal(harness.visibleItems[0].title, "Cached");
  assert.equal(harness.appliedSnapshots.length, 1);
  assert.equal(harness.appliedSnapshots[0].isFetching, true);
});

test("repo resource local seed ignores results after team changes", async () => {
  let resolveLocal;
  const localDelay = new Promise((resolve) => {
    resolveLocal = resolve;
  });
  const { harness, team } = createHarness();
  const originalLoadLocal = async () => {
    await localDelay;
    return [fakeResource({ title: "Late Local" })];
  };
  const delayedController = createRepoResourceQueryController({
    kind: "fakeResource",
    collectionField: "resources",
    queryKeyForTeam: (teamId) => ["fakeResourcesDelayed", teamId ?? null],
    getSelectedTeamId: () => harness.selectedTeamId,
    createSnapshot: ({ resources = [] } = {}) => ({ resources }),
    applySnapshotToState: (snapshot, { teamId } = {}) => {
      if (harness.selectedTeamId !== teamId) {
        return false;
      }
      harness.visibleItems = snapshot.resources;
      return true;
    },
    loadLocalItems: originalLoadLocal,
    loadRemoteSnapshot: async () => ({ resources: [] }),
    patchQueryData: (queryData) => queryData,
  });

  const seedPromise = delayedController.seedFromLocal(team);
  harness.selectedTeamId = "team-2";
  resolveLocal();
  const snapshot = await seedPromise;

  assert.equal(snapshot, null);
  assert.equal(harness.visibleItems.length, 0);
});

test("repo resource remote refresh snapshot is ignored by stale-team apply guard", async () => {
  const { controller, harness, team } = createHarness({
    remoteSnapshot: {
      resources: [fakeResource({ title: "Late Remote" })],
    },
  });

  const snapshot = await queryClient.fetchQuery(controller.createQueryOptions(team));
  harness.selectedTeamId = "team-2";
  const applied = harness.appliedSnapshots.length;

  const subscription = controller.ensureObserver(() => {}, team, { teamId: team.id });
  subscription.unsubscribe?.();
  subscription.observer?.destroy?.();

  assert.equal(snapshot.resources[0].title, "Late Remote");
  assert.equal(harness.appliedSnapshots.length, applied);
});

test("repo resource query preserves write-intent overlays during refresh", async () => {
  const { controller, harness, team } = createHarness({
    remoteSnapshot: {
      resources: [fakeResource({ title: "Server Title" })],
    },
  });
  const queryKey = ["fakeResources", "team-1"];
  queryClient.setQueryData(queryKey, {
    resources: [fakeResource({ title: "Optimistic", pendingMutation: "rename" })],
  });

  const snapshot = await queryClient.fetchQuery(controller.createQueryOptions(team));

  assert.equal(snapshot.resources[0].title, "Optimistic");
  assert.equal(snapshot.resources[0].pendingMutation, "rename");
});

test("repo resource lifecycle mutation rolls back query and visible state", async () => {
  const { controller, harness, team } = createHarness();
  const queryKey = ["fakeResources", "team-1"];
  queryClient.setQueryData(queryKey, {
    resources: [fakeResource({ title: "Original" })],
  });

  const mutation = controller.createLifecycleMutationOptions({
    team,
    resource: fakeResource(),
    mutationType: "rename",
    optimisticData: { title: "Renamed", pendingMutation: "rename" },
    commitMutation: async () => {},
    render: () => {},
  });
  const context = await mutation.onMutate();
  mutation.onError(new Error("failed"), undefined, context);

  assert.equal(queryClient.getQueryData(queryKey).resources[0].title, "Original");
  assert.equal(harness.visibleItems[0].title, "Original");
  assert.deepEqual(harness.badgeMessages, ["failed"]);
});

test("repo resource optional capabilities can be absent", async () => {
  const { controller, team } = createHarness();

  const snapshot = await queryClient.fetchQuery(controller.createQueryOptions(team));

  assert.equal(snapshot.resources[0].title, "Remote");
});
