import test from "node:test";
import assert from "node:assert/strict";

let invokeHandler = async () => null;

globalThis.document = {
  querySelector() {
    return null;
  },
};

globalThis.window = {
  __TAURI__: {
    core: {
      invoke: (command, payload) => invokeHandler(command, payload),
    },
  },
  addEventListener() {},
  removeEventListener() {},
  requestAnimationFrame(callback) {
    return setTimeout(callback, 0);
  },
  setTimeout,
  clearTimeout,
};

const { createResourcePageState } = await import("./resource-page-controller.js");
const { deleteQaList } = await import("./qa-list-lifecycle-flow.js");
const {
  createQaListsQuerySnapshot,
  resetQaListsQueryObserver,
} = await import("./qa-list-query.js");
const { qaListKeys, queryClient } = await import("./query-client.js");
const { resetSessionState, state } = await import("./state.js");

function flushAsyncWork() {
  return new Promise((resolve) => setImmediate(resolve));
}

function setupQaListLifecycleState({ showDeletedQaLists = false, includeDeletedQaList = false } = {}) {
  resetSessionState();
  const team = {
    id: "team-1",
    name: "Team 1",
    githubOrg: "team-1",
    installationId: 1,
    canManageProjects: true,
    canDelete: true,
  };
  const qaList = {
    id: "qa-list-1",
    repoName: "gnosis-qa-en",
    title: "Gnosis QA EN",
    lifecycleState: "active",
    language: { code: "en", name: "English" },
    termCount: 1,
  };

  state.teams = [team];
  state.selectedTeamId = team.id;
  state.auth.session = { sessionToken: "token" };
  state.qaListsPage = createResourcePageState();
  state.qaLists = [
    qaList,
    ...(includeDeletedQaList
      ? [{
          ...qaList,
          id: "deleted-qa-list",
          repoName: "deleted-qa-list",
          title: "Deleted QA List",
          lifecycleState: "deleted",
        }]
      : []),
  ];
  state.showDeletedQaLists = showDeletedQaLists;
  queryClient.setQueryData(
    qaListKeys.byTeam(team.id),
    createQaListsQuerySnapshot({ qaLists: state.qaLists }),
  );
}

test.afterEach(() => {
  resetQaListsQueryObserver();
  queryClient.clear();
  invokeHandler = async () => null;
  resetSessionState();
});

test("soft-deleting a QA list does not open a closed deleted QA lists section", async () => {
  setupQaListLifecycleState({ showDeletedQaLists: false });

  await deleteQaList(() => {}, "qa-list-1");
  await flushAsyncWork();

  assert.equal(state.qaLists[0].lifecycleState, "deleted");
  assert.equal(state.showDeletedQaLists, false);
});

test("soft-deleting a QA list preserves a visible and already-open deleted QA lists section", async () => {
  setupQaListLifecycleState({ showDeletedQaLists: true, includeDeletedQaList: true });

  await deleteQaList(() => {}, "qa-list-1");
  await flushAsyncWork();

  assert.equal(state.qaLists.find((item) => item.id === "qa-list-1").lifecycleState, "deleted");
  assert.equal(state.showDeletedQaLists, true);
});

test("soft-deleting a QA list closes a stale open flag when the deleted section is not visible", async () => {
  setupQaListLifecycleState({ showDeletedQaLists: true });

  await deleteQaList(() => {}, "qa-list-1");
  await flushAsyncWork();

  assert.equal(state.qaLists[0].lifecycleState, "deleted");
  assert.equal(state.showDeletedQaLists, false);
});
