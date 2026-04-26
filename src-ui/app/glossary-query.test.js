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
  createGlossariesQuerySnapshot,
  createGlossaryRenameMutationOptions,
  createGlossaryRestoreMutationOptions,
  createGlossarySoftDeleteMutationOptions,
  invalidateGlossariesQueryAfterMutation,
  preservePendingGlossaryLifecyclePatches,
} = await import("./glossary-query.js");
const { glossaryKeys, queryClient } = await import("./query-client.js");

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

test.afterEach(() => {
  queryClient.clear();
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

test("rename optimistic patch updates query cache and state immediately", async () => {
  resetSessionState();
  state.selectedTeamId = "team-1";
  state.glossariesPage = createResourcePageState();
  const team = { id: "team-1", installationId: 1 };
  const queryKey = glossaryKeys.byTeam(team.id);
  let optimisticApplied = false;
  queryClient.setQueryData(
    queryKey,
    createGlossariesQuerySnapshot({ glossaries: [glossary()] }),
  );

  const options = createGlossaryRenameMutationOptions({
    team,
    glossary: glossary(),
    nextTitle: "Renamed Glossary",
    commitMutation: async () => {},
    onOptimisticApplied: () => {
      optimisticApplied = true;
    },
  });

  await options.onMutate();

  assert.equal(queryClient.getQueryData(queryKey).glossaries[0].title, "Renamed Glossary");
  assert.equal(queryClient.getQueryData(queryKey).glossaries[0].pendingMutation, "rename");
  assert.equal(state.glossaries[0].title, "Renamed Glossary");
  assert.equal(optimisticApplied, true);
});

test("rename optimistic failure rolls back query cache and state", async () => {
  resetSessionState();
  state.selectedTeamId = "team-1";
  state.glossariesPage = createResourcePageState();
  const team = { id: "team-1", installationId: 1 };
  const queryKey = glossaryKeys.byTeam(team.id);
  const snapshot = createGlossariesQuerySnapshot({ glossaries: [glossary()] });
  queryClient.setQueryData(queryKey, snapshot);

  const options = createGlossaryRenameMutationOptions({
    team,
    glossary: glossary(),
    nextTitle: "Renamed Glossary",
    commitMutation: async () => {},
  });

  const context = await options.onMutate();
  options.onError(new Error("failed"), undefined, context);

  assert.equal(queryClient.getQueryData(queryKey).glossaries[0].title, "Gnosis ES-VI");
  assert.equal(state.glossaries[0].title, "Gnosis ES-VI");
});

test("soft delete optimistic patch moves a glossary to deleted state", async () => {
  resetSessionState();
  state.selectedTeamId = "team-1";
  state.glossariesPage = createResourcePageState();
  const team = { id: "team-1", installationId: 1 };
  const queryKey = glossaryKeys.byTeam(team.id);
  queryClient.setQueryData(
    queryKey,
    createGlossariesQuerySnapshot({ glossaries: [glossary()] }),
  );

  const options = createGlossarySoftDeleteMutationOptions({
    team,
    glossary: glossary(),
    commitMutation: async () => {},
  });

  await options.onMutate();

  assert.equal(queryClient.getQueryData(queryKey).glossaries[0].lifecycleState, "deleted");
  assert.equal(queryClient.getQueryData(queryKey).glossaries[0].pendingMutation, "softDelete");
  assert.equal(state.glossaries[0].lifecycleState, "deleted");
});

test("restore optimistic patch moves a glossary to active state", async () => {
  resetSessionState();
  state.selectedTeamId = "team-1";
  state.glossariesPage = createResourcePageState();
  const team = { id: "team-1", installationId: 1 };
  const deletedGlossary = glossary({ lifecycleState: "deleted" });
  const queryKey = glossaryKeys.byTeam(team.id);
  queryClient.setQueryData(
    queryKey,
    createGlossariesQuerySnapshot({ glossaries: [deletedGlossary] }),
  );

  const options = createGlossaryRestoreMutationOptions({
    team,
    glossary: deletedGlossary,
    commitMutation: async () => {},
  });

  await options.onMutate();

  assert.equal(queryClient.getQueryData(queryKey).glossaries[0].lifecycleState, "active");
  assert.equal(queryClient.getQueryData(queryKey).glossaries[0].pendingMutation, "restore");
  assert.equal(state.glossaries[0].lifecycleState, "active");
});

test("soft delete optimistic failure rolls back lifecycle state", async () => {
  resetSessionState();
  state.selectedTeamId = "team-1";
  state.glossariesPage = createResourcePageState();
  const team = { id: "team-1", installationId: 1 };
  const queryKey = glossaryKeys.byTeam(team.id);
  queryClient.setQueryData(
    queryKey,
    createGlossariesQuerySnapshot({ glossaries: [glossary()] }),
  );

  const options = createGlossarySoftDeleteMutationOptions({
    team,
    glossary: glossary(),
    commitMutation: async () => {},
  });

  const context = await options.onMutate();
  options.onError(new Error("failed"), undefined, context);

  assert.equal(queryClient.getQueryData(queryKey).glossaries[0].lifecycleState, "active");
  assert.equal(state.glossaries[0].lifecycleState, "active");
});

test("rename mutations use the team metadata mutation scope", () => {
  const options = createGlossaryRenameMutationOptions({
    team: { id: "team-1", installationId: 42 },
    glossary: glossary(),
    nextTitle: "Renamed Glossary",
    commitMutation: async () => {},
  });

  assert.deepEqual(options.scope, { id: "team-metadata:42" });
});

test("delete and restore mutations use the team metadata mutation scope", () => {
  const team = { id: "team-1", installationId: 42 };

  assert.deepEqual(
    createGlossarySoftDeleteMutationOptions({
      team,
      glossary: glossary(),
      commitMutation: async () => {},
    }).scope,
    { id: "team-metadata:42" },
  );
  assert.deepEqual(
    createGlossaryRestoreMutationOptions({
      team,
      glossary: glossary({ lifecycleState: "deleted" }),
      commitMutation: async () => {},
    }).scope,
    { id: "team-metadata:42" },
  );
});

test("refresh snapshots preserve pending lifecycle optimistic patches", () => {
  const previousSnapshot = createGlossariesQuerySnapshot({
    glossaries: [
      glossary({
        title: "Optimistic Rename",
        pendingMutation: "rename",
      }),
      glossary({
        id: "glossary-2",
        title: "Deleted Optimistically",
        lifecycleState: "deleted",
        pendingMutation: "softDelete",
      }),
    ],
  });
  const nextSnapshot = createGlossariesQuerySnapshot({
    glossaries: [
      glossary({ title: "Server Title" }),
      glossary({
        id: "glossary-2",
        title: "Deleted Optimistically",
        lifecycleState: "active",
      }),
    ],
  });

  const merged = preservePendingGlossaryLifecyclePatches(nextSnapshot, previousSnapshot);

  assert.equal(merged.glossaries[0].title, "Optimistic Rename");
  assert.equal(merged.glossaries[0].pendingMutation, "rename");
  assert.equal(merged.glossaries[1].lifecycleState, "deleted");
  assert.equal(merged.glossaries[1].pendingMutation, "softDelete");
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
