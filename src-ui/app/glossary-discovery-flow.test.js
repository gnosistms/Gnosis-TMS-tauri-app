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
const {
  loadTeamGlossaries,
  primeGlossariesLoadingState,
} = await import("./glossary-discovery-flow.js");
const { createResourcePageState } = await import("./resource-page-controller.js");
const { resetSessionState, state } = await import("./state.js");
const { teamCacheKey } = await import("./team-cache.js");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function setupGlossaryLoadState() {
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
  invokeHandler = async () => null;
  queryClient.clear();
  resetSessionState();
});

test("stale glossary refresh failures do not mutate the newly selected team loading state", async () => {
  setupGlossaryLoadState();
  const remoteStarted = deferred();
  const remoteFailure = deferred();
  invokeHandler = async (command) => {
    if (command === "list_local_gtms_glossaries") {
      return [];
    }
    if (command === "sync_local_team_metadata_repo" || command === "ensure_local_team_metadata_repo") {
      return null;
    }
    if (command === "list_local_gnosis_glossary_metadata_records") {
      return [];
    }
    if (command === "inspect_and_migrate_local_repo_bindings") {
      return { issues: [], autoRepairedCount: 0 };
    }
    if (command === "list_gnosis_glossaries_for_installation") {
      remoteStarted.resolve();
      return remoteFailure.promise;
    }
    return null;
  };

  const loadPromise = loadTeamGlossaries(() => {}, "team-1");
  await remoteStarted.promise;

  state.selectedTeamId = "team-2";
  state.glossariesPage.isRefreshing = true;
  state.glossaryDiscovery = {
    status: "loading",
    error: "",
    brokerWarning: "",
    recoveryMessage: "",
  };
  remoteFailure.reject(new Error("team-1 remote failed"));
  await loadPromise;

  assert.equal(state.selectedTeamId, "team-2");
  assert.equal(state.glossaryDiscovery.status, "loading");
  assert.equal(state.glossaryDiscovery.error, "");
  assert.equal(state.glossariesPage.isRefreshing, true);
});

test("glossary loading prime preserves visible data only for the selected team cache key", () => {
  setupGlossaryLoadState();
  const team = state.teams[0];
  state.glossariesPage = createResourcePageState({
    visibleTeamId: team.id,
    visibleCacheKey: teamCacheKey(team),
  });
  state.glossaries = [{ id: "glossary-1", title: "Team 1 Glossary" }];

  primeGlossariesLoadingState(team.id, { preserveVisibleData: true });

  assert.equal(state.glossaries[0].title, "Team 1 Glossary");
  assert.equal(state.glossariesPage.isRefreshing, false);

  primeGlossariesLoadingState("team-2", { preserveVisibleData: true, seedFromCache: false });

  assert.deepEqual(state.glossaries, []);
  assert.equal(state.glossariesPage.visibleTeamId, null);
  assert.equal(state.glossariesPage.visibleCacheKey, null);
  assert.equal(state.glossariesPage.isRefreshing, true);
});

test("glossary load treats unowned preserve requests as normal loads on failure", async () => {
  setupGlossaryLoadState();
  const team1 = state.teams[0];
  state.glossariesPage = createResourcePageState({
    visibleTeamId: "team-2",
    visibleCacheKey: teamCacheKey(state.teams[1]),
  });
  state.glossaries = [{ id: "team-2-glossary", title: "Team 2 Glossary" }];
  invokeHandler = async (command) => {
    if (command === "list_local_gtms_glossaries") {
      return [];
    }
    if (command === "sync_local_team_metadata_repo" || command === "ensure_local_team_metadata_repo") {
      return null;
    }
    if (command === "list_local_gnosis_glossary_metadata_records") {
      return [];
    }
    if (command === "inspect_and_migrate_local_repo_bindings") {
      return { issues: [], autoRepairedCount: 0 };
    }
    if (command === "list_gnosis_glossaries_for_installation") {
      throw new Error("team-1 remote failed");
    }
    return null;
  };

  await loadTeamGlossaries(() => {}, team1.id, { preserveVisibleData: true });

  assert.equal(state.selectedTeamId, team1.id);
  assert.deepEqual(state.glossaries, []);
  assert.equal(state.glossaryDiscovery.status, "error");
  assert.equal(state.glossaryDiscovery.error, "team-1 remote failed");
  assert.equal(state.glossariesPage.isRefreshing, false);
});
