import test from "node:test";
import assert from "node:assert/strict";

import { QueryObserver } from "@tanstack/query-core";

globalThis.document = globalThis.document ?? {
  querySelector: () => null,
};
globalThis.window = globalThis.window ?? {
  __TAURI__: {},
  requestAnimationFrame: (callback) => setTimeout(callback, 0),
};

const { createResourcePageState } = await import("./resource-page-controller.js");
const { resetSessionState, state } = await import("./state.js");
const {
  applyGlossariesQuerySnapshotToState,
  createGlossaryPermanentDeleteMutationOptions,
  createGlossaryRenameMutationOptions,
  createGlossaryRestoreMutationOptions,
  createGlossarySoftDeleteMutationOptions,
  createGlossariesQuerySnapshot,
  invalidateGlossariesQueryAfterMutation,
  preservePendingGlossaryLifecyclePatches,
  seedGlossariesQueryFromCache,
} = await import("./glossary-query.js");
const { glossaryKeys, queryClient } = await import("./query-client.js");
const { teamCacheKey } = await import("./team-cache.js");
const {
  getGlossaryWriteIntent,
  glossaryLifecycleIntentKey,
  glossaryTitleIntentKey,
  requestGlossaryWriteIntent,
  resetGlossaryWriteCoordinator,
  teamMetadataWriteScope,
} = await import("./glossary-write-coordinator.js");

function glossary(overrides = {}) {
  return {
    id: "glossary-1",
    repoName: "gnosis-es-vi",
    title: "Gnosis ES-VI",
    lifecycleState: "active",
    sourceLanguage: { code: "es", name: "Spanish" },
    targetLanguage: { code: "vi", name: "Vietnamese" },
    termCount: 1,
    ...overrides,
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test.afterEach(() => {
  queryClient.clear();
  resetGlossaryWriteCoordinator();
  resetSessionState();
});

test("glossary query adapter maps snapshots into glossary page state", () => {
  resetSessionState();
  state.selectedTeamId = "team-1";
  state.glossariesPage = createResourcePageState();
  const snapshot = createGlossariesQuerySnapshot({
    glossaries: [glossary()],
    syncSnapshots: [{ repoName: "gnosis-es-vi", status: "synced" }],
    brokerWarning: "Broker warning",
    recoveryMessage: "Recovered",
  });

  const applied = applyGlossariesQuerySnapshotToState(snapshot, {
    teamId: "team-1",
    isFetching: true,
  });

  assert.equal(applied, true);
  assert.equal(state.glossaries.length, 1);
  assert.equal(state.glossaries[0].title, "Gnosis ES-VI");
  assert.equal(state.glossaryRepoSyncByRepoName["gnosis-es-vi"].status, "synced");
  assert.equal(state.glossaryDiscovery.status, "ready");
  assert.equal(state.glossaryDiscovery.brokerWarning, "Broker warning");
  assert.equal(state.glossariesPage.isRefreshing, true);
  assert.equal(state.glossariesPage.visibleTeamId, "team-1");
});

test("glossary query adapter ignores stale team snapshots", () => {
  resetSessionState();
  state.selectedTeamId = "team-2";
  state.glossaries = [glossary({ id: "existing", title: "Existing" })];

  const applied = applyGlossariesQuerySnapshotToState(
    createGlossariesQuerySnapshot({
      glossaries: [glossary({ title: "Stale" })],
    }),
    { teamId: "team-1" },
  );

  assert.equal(applied, false);
  assert.equal(state.glossaries.length, 1);
  assert.equal(state.glossaries[0].title, "Existing");
});

test("glossary query cache seed applies only selected-team cache", () => {
  resetSessionState();
  const team = { id: "team-1", installationId: 1 };
  state.selectedTeamId = team.id;
  state.glossariesPage = createResourcePageState();

  const snapshot = seedGlossariesQueryFromCache(team, {
    loadStoredGlossariesForTeam: () => ({
      exists: true,
      cacheKey: teamCacheKey(team),
      updatedAt: "2026-05-14T00:00:00.000Z",
      glossaries: [glossary({ title: "Cached Glossary" })],
    }),
  });

  assert.equal(snapshot.glossaries[0].title, "Cached Glossary");
  assert.equal(queryClient.getQueryData(glossaryKeys.byTeam(team.id)).glossaries[0].title, "Cached Glossary");
  assert.equal(state.glossaries[0].title, "Cached Glossary");
  assert.equal(state.glossariesPage.visibleTeamId, team.id);
  assert.equal(state.glossariesPage.visibleCacheKey, teamCacheKey(team));
  assert.equal(state.glossariesPage.cacheUpdatedAt, "2026-05-14T00:00:00.000Z");
});

test("glossary query cache seed ignores mismatched cache keys without mutating state", () => {
  resetSessionState();
  const team = { id: "team-1", installationId: 1 };
  state.selectedTeamId = team.id;
  state.glossariesPage = createResourcePageState();
  state.glossaries = [glossary({ title: "Existing" })];

  const snapshot = seedGlossariesQueryFromCache(team, {
    loadStoredGlossariesForTeam: () => ({
      exists: true,
      cacheKey: "installation:other",
      glossaries: [glossary({ title: "Wrong Cache" })],
    }),
  });

  assert.equal(snapshot, null);
  assert.equal(state.glossaries[0].title, "Existing");
  assert.equal(queryClient.getQueryData(glossaryKeys.byTeam(team.id)), undefined);
});

test("glossary query adapter overlays pending title intents", () => {
  resetSessionState();
  state.selectedTeamId = "team-1";
  state.glossariesPage = createResourcePageState();

  requestGlossaryWriteIntent({
    key: glossaryTitleIntentKey("glossary-1"),
    scope: teamMetadataWriteScope({ installationId: 1 }),
    teamId: "team-1",
    glossaryId: "glossary-1",
    type: "glossaryTitle",
    value: { title: "Optimistic Rename" },
  }, {
    run: async () => {},
  });

  applyGlossariesQuerySnapshotToState(
    createGlossariesQuerySnapshot({ glossaries: [glossary({ title: "Server Title" })] }),
    { teamId: "team-1" },
  );

  assert.equal(state.glossaries[0].title, "Optimistic Rename");
  assert.equal(state.glossaries[0].pendingMutation, "rename");
});

test("glossary query adapter overlays pending lifecycle intents", () => {
  resetSessionState();
  state.selectedTeamId = "team-1";
  state.glossariesPage = createResourcePageState();

  requestGlossaryWriteIntent({
    key: glossaryLifecycleIntentKey("glossary-1"),
    scope: teamMetadataWriteScope({ installationId: 1 }),
    teamId: "team-1",
    glossaryId: "glossary-1",
    type: "glossaryLifecycle",
    value: { lifecycleState: "deleted" },
  }, {
    run: async () => {},
  });

  applyGlossariesQuerySnapshotToState(
    createGlossariesQuerySnapshot({ glossaries: [glossary({ lifecycleState: "active" })] }),
    { teamId: "team-1" },
  );

  assert.equal(state.glossaries[0].lifecycleState, "deleted");
  assert.equal(state.glossaries[0].pendingMutation, "softDelete");
});

test("confirmed glossary snapshots clear matching write intents after write success", async () => {
  resetSessionState();
  state.selectedTeamId = "team-1";
  state.glossariesPage = createResourcePageState();
  const key = glossaryTitleIntentKey("glossary-1");

  requestGlossaryWriteIntent({
    key,
    scope: teamMetadataWriteScope({ installationId: 1 }),
    teamId: "team-1",
    glossaryId: "glossary-1",
    type: "glossaryTitle",
    value: { title: "Confirmed Rename" },
  }, {
    run: async () => {},
  });
  await delay(5);

  applyGlossariesQuerySnapshotToState(
    createGlossariesQuerySnapshot({ glossaries: [glossary({ title: "Confirmed Rename" })] }),
    { teamId: "team-1" },
  );

  assert.equal(getGlossaryWriteIntent(key), null);
  assert.equal(state.glossaries[0].title, "Confirmed Rename");
});

test("glossary lifecycle mutations patch query cache and state immediately", async () => {
  resetSessionState();
  state.selectedTeamId = "team-1";
  state.glossariesPage = createResourcePageState();
  const team = { id: "team-1", installationId: 1 };
  const queryKey = glossaryKeys.byTeam(team.id);
  queryClient.setQueryData(queryKey, createGlossariesQuerySnapshot({ glossaries: [glossary()] }));

  await createGlossarySoftDeleteMutationOptions({
    team,
    glossary: glossary(),
    commitMutation: async () => {},
  }).onMutate();

  assert.equal(queryClient.getQueryData(queryKey).glossaries[0].lifecycleState, "deleted");
  assert.equal(queryClient.getQueryData(queryKey).glossaries[0].pendingMutation, "softDelete");
  assert.equal(state.glossaries[0].lifecycleState, "deleted");

  await createGlossaryRestoreMutationOptions({
    team,
    glossary: glossary({ lifecycleState: "deleted" }),
    commitMutation: async () => {},
  }).onMutate();

  assert.equal(queryClient.getQueryData(queryKey).glossaries[0].lifecycleState, "active");
  assert.equal(queryClient.getQueryData(queryKey).glossaries[0].pendingMutation, "restore");
  assert.equal(state.glossaries[0].lifecycleState, "active");
});

test("glossary rename mutation rolls back query cache and state on failure", async () => {
  resetSessionState();
  state.selectedTeamId = "team-1";
  state.glossariesPage = createResourcePageState();
  const team = { id: "team-1", installationId: 1 };
  const queryKey = glossaryKeys.byTeam(team.id);
  queryClient.setQueryData(queryKey, createGlossariesQuerySnapshot({ glossaries: [glossary()] }));

  const options = createGlossaryRenameMutationOptions({
    team,
    glossary: glossary(),
    nextTitle: "Renamed",
    commitMutation: async () => {},
  });
  const context = await options.onMutate();
  options.onError(new Error("failed"), undefined, context);

  assert.equal(queryClient.getQueryData(queryKey).glossaries[0].title, "Gnosis ES-VI");
  assert.equal(state.glossaries[0].title, "Gnosis ES-VI");
});

test("glossary permanent delete mutation removes and rolls back query cache", async () => {
  resetSessionState();
  state.selectedTeamId = "team-1";
  state.glossariesPage = createResourcePageState();
  const team = { id: "team-1", installationId: 1 };
  const queryKey = glossaryKeys.byTeam(team.id);
  queryClient.setQueryData(queryKey, createGlossariesQuerySnapshot({
    glossaries: [glossary({ lifecycleState: "deleted" })],
  }));

  const options = createGlossaryPermanentDeleteMutationOptions({
    team,
    glossary: glossary({ lifecycleState: "deleted" }),
    commitMutation: async () => {},
  });
  const context = await options.onMutate();

  assert.equal(queryClient.getQueryData(queryKey).glossaries.length, 0);
  assert.equal(state.glossaries.length, 0);

  options.onError(new Error("failed"), undefined, context);

  assert.equal(queryClient.getQueryData(queryKey).glossaries.length, 1);
  assert.equal(state.glossaries.length, 1);
  assert.equal(state.glossaries[0].id, "glossary-1");
});

test("refresh snapshots preserve pending glossary lifecycle patches", () => {
  const previousSnapshot = createGlossariesQuerySnapshot({
    glossaries: [
      glossary({ id: "rename-glossary", title: "Optimistic Rename", pendingMutation: "rename" }),
      glossary({ id: "delete-glossary", lifecycleState: "deleted", pendingMutation: "softDelete" }),
      glossary({ id: "restore-glossary", lifecycleState: "active", pendingMutation: "restore" }),
    ],
  });
  const staleRefreshSnapshot = createGlossariesQuerySnapshot({
    glossaries: [
      glossary({ id: "rename-glossary", title: "Server Title" }),
      glossary({ id: "delete-glossary", lifecycleState: "active" }),
      glossary({ id: "restore-glossary", lifecycleState: "deleted" }),
    ],
  });

  const merged = preservePendingGlossaryLifecyclePatches(staleRefreshSnapshot, previousSnapshot);

  assert.equal(merged.glossaries.find((item) => item.id === "rename-glossary").title, "Optimistic Rename");
  assert.equal(merged.glossaries.find((item) => item.id === "delete-glossary").lifecycleState, "deleted");
  assert.equal(merged.glossaries.find((item) => item.id === "restore-glossary").lifecycleState, "active");
});

test("refresh snapshots preserve settled local glossary lifecycle intent until server agrees", () => {
  const previousSnapshot = createGlossariesQuerySnapshot({
    glossaries: [
      glossary({ id: "rename-glossary", title: "Local Rename", localLifecycleIntent: "rename" }),
      glossary({ id: "delete-glossary", lifecycleState: "deleted", localLifecycleIntent: "softDelete" }),
      glossary({ id: "restore-glossary", lifecycleState: "active", localLifecycleIntent: "restore" }),
    ],
  });
  const staleRefreshSnapshot = createGlossariesQuerySnapshot({
    glossaries: [
      glossary({ id: "rename-glossary", title: "Server Title" }),
      glossary({ id: "delete-glossary", lifecycleState: "active" }),
      glossary({ id: "restore-glossary", lifecycleState: "deleted" }),
    ],
  });

  const merged = preservePendingGlossaryLifecyclePatches(staleRefreshSnapshot, previousSnapshot);

  assert.equal(merged.glossaries.find((item) => item.id === "rename-glossary").title, "Local Rename");
  assert.equal(merged.glossaries.find((item) => item.id === "delete-glossary").localLifecycleIntent, "softDelete");
  assert.equal(merged.glossaries.find((item) => item.id === "restore-glossary").localLifecycleIntent, "restore");
});

test("mutation settle invalidates active glossary query once without explicit fetch", async () => {
  resetSessionState();
  state.selectedTeamId = "team-1";
  const team = { id: "team-1", installationId: 1 };
  const queryKey = glossaryKeys.byTeam(team.id);
  queryClient.setQueryData(
    queryKey,
    createGlossariesQuerySnapshot({ glossaries: [glossary()] }),
  );
  const observer = new QueryObserver(queryClient, {
    queryKey,
    queryFn: async () => createGlossariesQuerySnapshot({ glossaries: [glossary()] }),
  });
  const unsubscribe = observer.subscribe(() => {});
  const originalInvalidateQueries = queryClient.invalidateQueries.bind(queryClient);
  const originalFetchQuery = queryClient.fetchQuery.bind(queryClient);
  let invalidateCount = 0;
  let fetchCount = 0;
  queryClient.invalidateQueries = async (filters) => {
    invalidateCount += 1;
    assert.deepEqual(filters.queryKey, queryKey);
  };
  queryClient.fetchQuery = async () => {
    fetchCount += 1;
  };

  try {
    await invalidateGlossariesQueryAfterMutation(team);
  } finally {
    queryClient.invalidateQueries = originalInvalidateQueries;
    queryClient.fetchQuery = originalFetchQuery;
    unsubscribe();
  }

  assert.equal(invalidateCount, 1);
  assert.equal(fetchCount, 0);
});
