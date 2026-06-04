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
const { loadRepoBackedQaListsForTeam } = await import("./qa-list-repo-flow.js");
const { createResourcePageState } = await import("./resource-page-controller.js");
const { resetSessionState, state } = await import("./state.js");
const { getNoticeBadgeText } = await import("./status-feedback.js");
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

  state.qaListsPage = createResourcePageState({
    visibleTeamId: "team-2",
    visibleCacheKey: teamCacheKey(state.teams[1]),
  });
  state.qaLists = [{ id: "team-2-qa", title: "Team 2 QA" }];
  state.selectedQaListId = "team-2-qa";
  primeQaListsLoadingState(team.id, { preserveVisibleData: true });
  assert.deepEqual(state.qaLists, []);
  assert.equal(state.selectedQaListId, null);
  assert.equal(state.qaListsPage.visibleTeamId, null);
  assert.equal(state.qaListsPage.visibleCacheKey, null);
  assert.equal(state.qaListsPage.isRefreshing, true);

  state.qaListsPage = createResourcePageState({
    visibleTeamId: team.id,
    visibleCacheKey: teamCacheKey(team),
  });
  state.qaLists = [{ id: "qa-1", title: "Team 1 QA" }];
  state.selectedQaListId = "qa-1";

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

test("QA list fallback sync skips repos already deleted in visible state", async () => {
  setupQaListLoadState();
  const team = state.teams[0];
  state.qaLists = [{
    id: "qa-deleted",
    qaListId: "qa-deleted",
    repoName: "qa-deleted",
    fullName: "team-1/qa-deleted",
    title: "Deleted QA",
    language: { code: "en", name: "English" },
    lifecycleState: "deleted",
    recordState: "live",
    remoteState: "linked",
  }];

  invokeHandler = async (command) => {
    if (command === "list_local_gtms_qa_lists") {
      return [];
    }
    if (command === "sync_local_team_metadata_repo" || command === "ensure_local_team_metadata_repo") {
      throw new Error("metadata unavailable");
    }
    if (command === "list_local_gnosis_qa_list_metadata_records") {
      throw new Error("metadata unavailable");
    }
    if (command === "list_gnosis_qa_lists_for_installation") {
      return [{
        qaListId: "qa-deleted",
        name: "qa-deleted",
        fullName: "team-1/qa-deleted",
        defaultBranchName: "main",
      }];
    }
    if (command === "sync_gtms_qa_list_repos") {
      assert.fail("known deleted QA list should not be synced");
    }
    return null;
  };

  const result = await loadRepoBackedQaListsForTeam(team);

  assert.equal(result.syncSnapshots.length, 0);
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

test("QA list load treats unowned preserve requests as normal loads on failure", async () => {
  setupQaListLoadState();
  const team1 = state.teams[0];
  state.qaListsPage = createResourcePageState({
    visibleTeamId: "team-2",
    visibleCacheKey: teamCacheKey(state.teams[1]),
  });
  state.qaLists = [{ id: "team-2-qa", title: "Team 2 QA" }];
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

  await loadTeamQaLists(() => {}, team1.id, { preserveVisibleData: true });

  assert.equal(state.selectedTeamId, team1.id);
  assert.deepEqual(state.qaLists, []);
  assert.equal(state.qaListDiscovery.status, "error");
  assert.equal(state.qaListDiscovery.error, "team-1 remote failed");
  assert.equal(state.qaListsPage.isRefreshing, false);
});

test("QA list load keeps ready discovery state when local data survives a remote failure", async () => {
  setupQaListLoadState();
  invokeHandler = async (command) => {
    if (command === "list_local_gtms_qa_lists") {
      return [{
        id: "local-qa",
        title: "Local QA",
        language: { code: "en", name: "English" },
        repoName: "local-qa",
        fullName: "team-1/local-qa",
      }];
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

  assert.deepEqual(state.qaLists.map((qaList) => qaList.id), ["local-qa"]);
  assert.equal(state.qaListDiscovery.status, "ready");
  assert.equal(state.qaListDiscovery.error, "");
  assert.equal(getNoticeBadgeText(), "team-1 remote failed");
  assert.equal(state.qaListsPage.isRefreshing, false);
});

test("QA list load surfaces sync issues as notice badges", async () => {
  setupQaListLoadState();
  invokeHandler = async (command) => {
    if (command === "list_local_gtms_qa_lists") {
      return [{
        id: "qa-1",
        title: "Team 1 QA",
        language: { code: "en", name: "English" },
        repoName: "qa-1",
        fullName: "team-1/qa-1",
      }];
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
      return [{
        qaListId: "qa-1",
        name: "qa-1",
        fullName: "team-1/qa-1",
        defaultBranchName: "main",
      }];
    }
    if (command === "sync_gtms_qa_list_repos") {
      return [{
        repoName: "qa-1",
        status: "syncError",
        message: "Could not sync QA list repo qa-1.",
      }];
    }
    return null;
  };

  await loadTeamQaLists(() => {}, "team-1");

  assert.equal(getNoticeBadgeText(), "Could not sync QA list repo qa-1.");
  assert.equal(state.qaListDiscovery.status, "ready");
  assert.equal(state.qaListsPage.isRefreshing, false);
});
