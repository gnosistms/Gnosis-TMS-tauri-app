import test from "node:test";
import assert from "node:assert/strict";

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
  applyQaListsQuerySnapshotToState,
  createQaListRenameMutationOptions,
  createQaListRestoreMutationOptions,
  createQaListSoftDeleteMutationOptions,
  createQaListsQuerySnapshot,
  preserveQaListLifecyclePatchesInSnapshot,
} = await import("./qa-list-query.js");
const { qaListKeys, queryClient } = await import("./query-client.js");

function qaList(overrides = {}) {
  return {
    id: "qa-list-1",
    title: "Vietnamese QA",
    language: { code: "vi", name: "Vietnamese" },
    lifecycleState: "active",
    termCount: 1,
    terms: [],
    ...overrides,
  };
}

test.afterEach(() => {
  queryClient.clear();
  resetSessionState();
});

test("QA list query adapter maps snapshots into QA list page state", () => {
  resetSessionState();
  state.selectedTeamId = "team-1";
  state.qaListsPage = createResourcePageState();

  const applied = applyQaListsQuerySnapshotToState(
    createQaListsQuerySnapshot({ qaLists: [qaList()] }),
    { teamId: "team-1", isFetching: true },
  );

  assert.equal(applied, true);
  assert.equal(state.qaLists.length, 1);
  assert.equal(state.qaLists[0].title, "Vietnamese QA");
  assert.equal(state.qaListsPage.isRefreshing, true);
  assert.equal(state.qaListsPage.visibleTeamId, "team-1");
});

test("QA list query adapter ignores stale team snapshots", () => {
  resetSessionState();
  state.selectedTeamId = "team-2";
  state.qaLists = [qaList({ id: "existing", title: "Existing QA" })];

  const applied = applyQaListsQuerySnapshotToState(
    createQaListsQuerySnapshot({ qaLists: [qaList({ title: "Stale QA" })] }),
    { teamId: "team-1" },
  );

  assert.equal(applied, false);
  assert.equal(state.qaLists[0].title, "Existing QA");
});

test("QA list lifecycle mutations patch query cache and state immediately", async () => {
  resetSessionState();
  state.selectedTeamId = "team-1";
  state.qaListsPage = createResourcePageState();
  const team = { id: "team-1", installationId: 1 };
  const queryKey = qaListKeys.byTeam(team.id);
  queryClient.setQueryData(queryKey, createQaListsQuerySnapshot({ qaLists: [qaList()] }));

  await createQaListSoftDeleteMutationOptions({
    team,
    qaList: qaList(),
    commitMutation: async () => {},
  }).onMutate();

  assert.equal(queryClient.getQueryData(queryKey).qaLists[0].lifecycleState, "deleted");
  assert.equal(queryClient.getQueryData(queryKey).qaLists[0].pendingMutation, "softDelete");
  assert.equal(state.qaLists[0].lifecycleState, "deleted");

  await createQaListRestoreMutationOptions({
    team,
    qaList: qaList({ lifecycleState: "deleted" }),
    commitMutation: async () => {},
  }).onMutate();

  assert.equal(queryClient.getQueryData(queryKey).qaLists[0].lifecycleState, "active");
  assert.equal(queryClient.getQueryData(queryKey).qaLists[0].pendingMutation, "restore");
  assert.equal(state.qaLists[0].lifecycleState, "active");
});

test("QA list rename mutation rolls back query cache and state on failure", async () => {
  resetSessionState();
  state.selectedTeamId = "team-1";
  state.qaListsPage = createResourcePageState();
  const team = { id: "team-1", installationId: 1 };
  const queryKey = qaListKeys.byTeam(team.id);
  queryClient.setQueryData(queryKey, createQaListsQuerySnapshot({ qaLists: [qaList()] }));

  const options = createQaListRenameMutationOptions({
    team,
    qaList: qaList(),
    nextTitle: "Renamed QA",
    commitMutation: async () => {},
  });
  const context = await options.onMutate();
  options.onError(new Error("failed"), undefined, context);

  assert.equal(queryClient.getQueryData(queryKey).qaLists[0].title, "Vietnamese QA");
  assert.equal(state.qaLists[0].title, "Vietnamese QA");
});

test("refresh snapshots preserve pending QA list lifecycle patches", () => {
  const previousSnapshot = createQaListsQuerySnapshot({
    qaLists: [
      qaList({ id: "rename-qa", title: "Optimistic Rename", pendingMutation: "rename" }),
      qaList({ id: "delete-qa", lifecycleState: "deleted", pendingMutation: "softDelete" }),
      qaList({ id: "restore-qa", lifecycleState: "active", pendingMutation: "restore" }),
    ],
  });
  const staleRefreshSnapshot = createQaListsQuerySnapshot({
    qaLists: [
      qaList({ id: "rename-qa", title: "Server Title" }),
      qaList({ id: "delete-qa", lifecycleState: "active" }),
      qaList({ id: "restore-qa", lifecycleState: "deleted" }),
    ],
  });

  const merged = preserveQaListLifecyclePatchesInSnapshot(staleRefreshSnapshot, previousSnapshot);

  assert.equal(merged.qaLists.find((item) => item.id === "rename-qa").title, "Optimistic Rename");
  assert.equal(merged.qaLists.find((item) => item.id === "delete-qa").lifecycleState, "deleted");
  assert.equal(merged.qaLists.find((item) => item.id === "restore-qa").lifecycleState, "active");
});

test("refresh snapshots preserve settled local QA list lifecycle intent until server agrees", () => {
  const previousSnapshot = createQaListsQuerySnapshot({
    qaLists: [
      qaList({ id: "rename-qa", title: "Local Rename", localLifecycleIntent: "rename" }),
      qaList({ id: "delete-qa", lifecycleState: "deleted", localLifecycleIntent: "softDelete" }),
      qaList({ id: "restore-qa", lifecycleState: "active", localLifecycleIntent: "restore" }),
    ],
  });
  const staleRefreshSnapshot = createQaListsQuerySnapshot({
    qaLists: [
      qaList({ id: "rename-qa", title: "Server Title" }),
      qaList({ id: "delete-qa", lifecycleState: "active" }),
      qaList({ id: "restore-qa", lifecycleState: "deleted" }),
    ],
  });

  const merged = preserveQaListLifecyclePatchesInSnapshot(staleRefreshSnapshot, previousSnapshot);

  assert.equal(merged.qaLists.find((item) => item.id === "rename-qa").title, "Local Rename");
  assert.equal(merged.qaLists.find((item) => item.id === "delete-qa").localLifecycleIntent, "softDelete");
  assert.equal(merged.qaLists.find((item) => item.id === "restore-qa").localLifecycleIntent, "restore");
});

test("refresh snapshots preserve locally created QA lists omitted by stale refreshes", () => {
  const previousSnapshot = createQaListsQuerySnapshot({
    qaLists: [
      qaList({ id: "existing-qa", title: "Existing QA" }),
      qaList({ id: "created-qa", title: "Created QA", localLifecycleIntent: "create" }),
    ],
  });
  const staleRefreshSnapshot = createQaListsQuerySnapshot({
    qaLists: [
      qaList({ id: "existing-qa", title: "Existing QA" }),
    ],
  });

  const merged = preserveQaListLifecyclePatchesInSnapshot(staleRefreshSnapshot, previousSnapshot);

  assert.equal(merged.qaLists.some((item) => item.id === "created-qa"), true);
  assert.equal(merged.qaLists.find((item) => item.id === "created-qa").localLifecycleIntent, "create");
});

test("refresh snapshots clear locally created QA list intent after refresh includes the list", () => {
  const previousSnapshot = createQaListsQuerySnapshot({
    qaLists: [
      qaList({ id: "created-qa", title: "Created QA", localLifecycleIntent: "create" }),
    ],
  });
  const settledRefreshSnapshot = createQaListsQuerySnapshot({
    qaLists: [
      qaList({ id: "created-qa", title: "Created QA" }),
    ],
  });

  const merged = preserveQaListLifecyclePatchesInSnapshot(settledRefreshSnapshot, previousSnapshot);

  assert.equal(merged.qaLists.find((item) => item.id === "created-qa").localLifecycleIntent, undefined);
});
