import test from "node:test";
import assert from "node:assert/strict";

let invokeHandler = async () => null;

globalThis.document = {
  querySelector() {
    return null;
  },
  querySelectorAll() {
    return [];
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

const { queryClient } = await import("./query-client.js");
const { resetQaListsQueryObserver } = await import("./qa-list-query.js");
const {
  loadTeamQaLists,
  primeQaListsLoadingState,
} = await import("./qa-list-discovery-flow.js");
const { saveStoredQaListsForTeam } = await import("./qa-list-cache.js");
const { createResourcePageState } = await import("./resource-page-controller.js");
const { resetSessionState, state } = await import("./state.js");
const { teamCacheKey } = await import("./team-cache.js");
const { setActiveStorageLogin } = await import("./team-storage.js");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function setupQaListLoadState() {
  resetSessionState();
  queryClient.clear();
  state.auth.session = { sessionToken: "token" };
  state.selectedTeamId = "team-1";
  state.teams = [
    {
      id: "team-1",
      name: "Team 1",
      githubOrg: "team-1",
      installationId: 1,
    },
    {
      id: "team-2",
      name: "Team 2",
      githubOrg: "team-2",
      installationId: 2,
    },
  ];
}

test.afterEach(() => {
  resetQaListsQueryObserver();
  invokeHandler = async () => null;
  queryClient.clear();
  setActiveStorageLogin(null);
  resetSessionState();
});

test("stale QA list refresh failures do not mutate the newly selected team loading state", async () => {
  setupQaListLoadState();
  const remoteStarted = deferred();
  const remoteFailure = deferred();
  invokeHandler = async (command) => {
    if (command === "list_local_gtms_qa_lists") {
      return [];
    }
    if (command === "sync_local_team_metadata_repo" || command === "ensure_local_team_metadata_repo") {
      return null;
    }
    if (command === "list_local_gnosis_qa_list_metadata_records") {
      return [];
    }
    if (command === "inspect_and_migrate_local_repo_bindings") {
      return { issues: [], autoRepairedCount: 0 };
    }
    if (command === "list_gnosis_qa_lists_for_installation") {
      remoteStarted.resolve();
      return remoteFailure.promise;
    }
    return null;
  };

  const loadPromise = loadTeamQaLists(() => {}, "team-1");
  await remoteStarted.promise;

  state.selectedTeamId = "team-2";
  state.qaListsPage.isRefreshing = true;
  state.qaListDiscovery = {
    status: "loading",
    error: "",
    brokerWarning: "",
    recoveryMessage: "",
  };
  remoteFailure.reject(new Error("team-1 remote failed"));
  await loadPromise;

  assert.equal(state.selectedTeamId, "team-2");
  assert.equal(state.qaListDiscovery.status, "loading");
  assert.equal(state.qaListDiscovery.error, "");
  assert.equal(state.qaListsPage.isRefreshing, true);
});

test("QA list loading prime preserves visible data for the selected team and clears otherwise", () => {
  setupQaListLoadState();
  const team = state.teams[0];
  state.qaListsPage = createResourcePageState({
    visibleTeamId: team.id,
    visibleCacheKey: teamCacheKey(team),
  });
  state.qaLists = [{ id: "qa-1", title: "Team 1 QA" }];
  state.selectedQaListId = "qa-1";

  // Selected team (team-1) -> preserved (QA preserves on selected-team match too).
  primeQaListsLoadingState(team.id, { preserveVisibleData: true });
  assert.equal(state.qaLists[0].title, "Team 1 QA");
  assert.equal(state.qaListsPage.isRefreshing, false);

  // Non-selected, non-owned team (team-2) -> cleared and marked refreshing.
  primeQaListsLoadingState("team-2", { preserveVisibleData: true });
  assert.deepEqual(state.qaLists, []);
  assert.equal(state.selectedQaListId, null);
  assert.equal(state.qaListsPage.visibleTeamId, null);
  assert.equal(state.qaListsPage.visibleCacheKey, null);
  assert.equal(state.qaListsPage.isRefreshing, true);
});

test("QA list loading prime can skip seeding from cache", () => {
  setupQaListLoadState();
  setActiveStorageLogin("qa-discovery-cache-test");
  const team = state.teams[0];
  saveStoredQaListsForTeam(team, [{ id: "cached-qa-list", title: "Cached QA" }]);

  primeQaListsLoadingState(team.id, { seedFromCache: false });

  assert.deepEqual(state.qaLists, []);
  assert.equal(state.qaListDiscovery.status, "loading");
  assert.equal(state.qaListsPage.isRefreshing, true);
});

test("QA list normal load surfaces a remote failure as an error discovery state", async () => {
  setupQaListLoadState();
  invokeHandler = async (command) => {
    if (command === "list_local_gtms_qa_lists") {
      return [];
    }
    if (command === "sync_local_team_metadata_repo" || command === "ensure_local_team_metadata_repo") {
      return null;
    }
    if (command === "list_local_gnosis_qa_list_metadata_records") {
      return [];
    }
    if (command === "inspect_and_migrate_local_repo_bindings") {
      return { issues: [], autoRepairedCount: 0 };
    }
    if (command === "list_gnosis_qa_lists_for_installation") {
      throw new Error("team-1 remote failed");
    }
    return null;
  };

  await loadTeamQaLists(() => {}, "team-1");

  assert.equal(state.selectedTeamId, "team-1");
  assert.deepEqual(state.qaLists, []);
  assert.equal(state.qaListDiscovery.status, "error");
  assert.equal(state.qaListDiscovery.error, "team-1 remote failed");
  assert.equal(state.qaListsPage.isRefreshing, false);
});
