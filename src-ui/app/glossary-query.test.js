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
  invalidateGlossariesQueryAfterMutation,
} = await import("./glossary-query.js");
const { glossaryKeys, queryClient } = await import("./query-client.js");
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
