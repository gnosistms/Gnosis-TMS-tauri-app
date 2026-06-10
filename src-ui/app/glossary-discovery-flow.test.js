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

async function dispatchMockInvoke(command, payload) {
  if (command === "list_gnosis_resources_for_installation") {
    // The combined listing fans out to the per-type handlers so tests keep mocking the
    // legacy commands. A thrown listing error fails the whole combined call, matching
    // the real endpoint; unknown commands resolve to empty lists.
    const legacyList = async (legacyCommand) => {
      const result = await invokeHandler(legacyCommand, payload);
      return Array.isArray(result) ? result : [];
    };
    return {
      projects: await legacyList("list_gnosis_projects_for_installation"),
      glossaries: await legacyList("list_gnosis_glossaries_for_installation"),
      qaLists: await legacyList("list_gnosis_qa_lists_for_installation"),
      digest: "",
    };
  }
  return invokeHandler(command, payload);
}

globalThis.window = {
  __TAURI__: {
    core: {
      invoke: (command, payload) => dispatchMockInvoke(command, payload),
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
const { resetGlossariesQueryObserver } = await import("./glossary-query.js");
const {
  loadTeamGlossaries,
  primeGlossariesLoadingState,
} = await import("./glossary-discovery-flow.js");
const { loadStoredGlossariesForTeam } = await import("./glossary-cache.js");
const { loadRepoBackedGlossariesForTeam } = await import("./glossary-repo-flow.js");
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
  resetGlossariesQueryObserver();
  invokeHandler = async () => null;
  queryClient.clear();
  setActiveStorageLogin(null);
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

test("glossary fallback sync skips repos already deleted in visible state", async () => {
  setupGlossaryLoadState();
  const team = state.teams[0];
  state.glossaries = [{
    id: "glossary-deleted",
    glossaryId: "glossary-deleted",
    repoName: "glossary-deleted",
    fullName: "team-1/glossary-deleted",
    title: "Deleted glossary",
    lifecycleState: "deleted",
    recordState: "live",
    remoteState: "linked",
  }];

  invokeHandler = async (command) => {
    if (command === "list_local_gtms_glossaries") {
      return [];
    }
    if (command === "sync_local_team_metadata_repo" || command === "ensure_local_team_metadata_repo") {
      throw new Error("metadata unavailable");
    }
    if (command === "list_local_gnosis_glossary_metadata_records") {
      throw new Error("metadata unavailable");
    }
    if (command === "list_gnosis_glossaries_for_installation") {
      return [{
        glossaryId: "glossary-deleted",
        name: "glossary-deleted",
        fullName: "team-1/glossary-deleted",
        defaultBranchName: "main",
      }];
    }
    if (command === "sync_gtms_glossary_repos") {
      assert.fail("known deleted glossary should not be synced");
    }
    return null;
  };

  const result = await loadRepoBackedGlossariesForTeam(team);

  assert.equal(result.syncSnapshots.length, 0);
  assert.equal(
    result.brokerWarning,
    "Glossary metadata could not be loaded from the local team-metadata repo. metadata unavailable",
  );
});

test("repo-backed glossary load backfills missing metadata records for local repos", async () => {
  setupGlossaryLoadState();
  const team = state.teams[0];
  const remoteRepo = {
    name: "glossary-spanish-vietnamese",
    fullName: "team-1/glossary-spanish-vietnamese",
    repoId: 22,
    nodeId: "repo-node-22",
    defaultBranchName: "main",
    defaultBranchHeadOid: "head-remote",
  };
  const localGlossary = {
    glossaryId: "glossary-spanish-vietnamese-id",
    id: "glossary-spanish-vietnamese-id",
    title: "Spanish Vietnamese Glossary",
    repoName: remoteRepo.name,
    fullName: remoteRepo.fullName,
    sourceLanguage: { code: "es", name: "Spanish" },
    targetLanguage: { code: "vi", name: "Vietnamese" },
    lifecycleState: "active",
    termCount: 3,
  };
  let metadataRecords = [];
  let didSyncGlossaryRepo = false;

  invokeHandler = async (command, payload = {}) => {
    if (command === "list_local_gtms_glossaries") {
      return [localGlossary];
    }
    if (command === "list_gnosis_glossaries_for_installation") {
      return [remoteRepo];
    }
    if (command === "sync_local_team_metadata_repo" || command === "ensure_local_team_metadata_repo") {
      return { commitCreated: false };
    }
    if (command === "list_local_gnosis_glossary_metadata_records") {
      return metadataRecords;
    }
    if (command === "inspect_and_migrate_local_repo_bindings") {
      return { issues: [], autoRepairedCount: 0 };
    }
    if (command === "upsert_local_gnosis_glossary_metadata_record") {
      metadataRecords = [{
        id: payload.input.glossaryId,
        kind: "glossary",
        title: payload.input.title,
        repoName: payload.input.repoName,
        previousRepoNames: payload.input.previousRepoNames,
        githubRepoId: payload.input.githubRepoId,
        githubNodeId: payload.input.githubNodeId,
        fullName: payload.input.fullName,
        defaultBranch: payload.input.defaultBranch,
        lifecycleState: payload.input.lifecycleState,
        remoteState: payload.input.remoteState,
        recordState: payload.input.recordState,
        deletedAt: payload.input.deletedAt,
        sourceLanguage: payload.input.sourceLanguage,
        targetLanguage: payload.input.targetLanguage,
        termCount: localGlossary.termCount,
      }];
      return { commitCreated: true };
    }
    if (command === "sync_gtms_glossary_repos") {
      didSyncGlossaryRepo = true;
      assert.deepEqual(
        payload.input.glossaries.map((glossary) => glossary.repoName),
        [remoteRepo.name],
      );
      return [{ repoName: remoteRepo.name, status: "upToDate" }];
    }
    return { commitCreated: false };
  };

  const result = await loadRepoBackedGlossariesForTeam(team);

  assert.equal(didSyncGlossaryRepo, true);
  assert.equal(metadataRecords.length, 1);
  assert.equal(metadataRecords[0].id, localGlossary.id);
  assert.equal(metadataRecords[0].githubRepoId, remoteRepo.repoId);
  assert.equal(metadataRecords[0].githubNodeId, remoteRepo.nodeId);
  assert.deepEqual(metadataRecords[0].sourceLanguage, localGlossary.sourceLanguage);
  assert.deepEqual(metadataRecords[0].targetLanguage, localGlossary.targetLanguage);
  assert.equal(result.glossaries.length, 1);
  assert.equal(result.glossaries[0].id, localGlossary.id);
});

test("repo-backed glossary load bootstraps remote repos that do not have metadata yet", async () => {
  setupGlossaryLoadState();
  const team = state.teams[0];
  const remoteRepo = {
    name: "glossary-japanese-vietnamese",
    fullName: "team-1/glossary-japanese-vietnamese",
    repoId: 33,
    nodeId: "repo-node-33",
    defaultBranchName: "main",
    defaultBranchHeadOid: "head-remote",
  };
  const syncedGlossary = {
    glossaryId: "glossary-japanese-vietnamese-id",
    id: "glossary-japanese-vietnamese-id",
    title: "Japanese Vietnamese Glossary",
    repoName: remoteRepo.name,
    fullName: remoteRepo.fullName,
    sourceLanguage: { code: "ja", name: "Japanese" },
    targetLanguage: { code: "vi", name: "Vietnamese" },
    lifecycleState: "active",
    termCount: 0,
  };
  let metadataRecords = [];
  let didSyncGlossaryRepo = false;

  invokeHandler = async (command, payload = {}) => {
    if (command === "list_local_gtms_glossaries") {
      return didSyncGlossaryRepo ? [syncedGlossary] : [];
    }
    if (command === "list_gnosis_glossaries_for_installation") {
      return [remoteRepo];
    }
    if (command === "sync_local_team_metadata_repo" || command === "ensure_local_team_metadata_repo") {
      return { commitCreated: false };
    }
    if (command === "list_local_gnosis_glossary_metadata_records") {
      return metadataRecords;
    }
    if (command === "inspect_and_migrate_local_repo_bindings") {
      return { issues: [], autoRepairedCount: 0 };
    }
    if (command === "sync_gtms_glossary_repos") {
      didSyncGlossaryRepo = true;
      assert.deepEqual(
        payload.input.glossaries.map((glossary) => glossary.repoName),
        [remoteRepo.name],
      );
      return [{ repoName: remoteRepo.name, status: "upToDate" }];
    }
    if (command === "upsert_local_gnosis_glossary_metadata_record") {
      metadataRecords = [{
        id: payload.input.glossaryId,
        kind: "glossary",
        title: payload.input.title,
        repoName: payload.input.repoName,
        previousRepoNames: payload.input.previousRepoNames,
        githubRepoId: payload.input.githubRepoId,
        githubNodeId: payload.input.githubNodeId,
        fullName: payload.input.fullName,
        defaultBranch: payload.input.defaultBranch,
        lifecycleState: payload.input.lifecycleState,
        remoteState: payload.input.remoteState,
        recordState: payload.input.recordState,
        deletedAt: payload.input.deletedAt,
        sourceLanguage: payload.input.sourceLanguage,
        targetLanguage: payload.input.targetLanguage,
        termCount: syncedGlossary.termCount,
      }];
      return { commitCreated: true };
    }
    return { commitCreated: false };
  };

  const result = await loadRepoBackedGlossariesForTeam(team);

  assert.equal(didSyncGlossaryRepo, true);
  assert.equal(result.glossaries.length, 1);
  assert.equal(result.glossaries[0].id, syncedGlossary.id);
  assert.equal(metadataRecords.length, 1);
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

test("glossary successful load applies and persists the refreshed query snapshot", async () => {
  setupGlossaryLoadState();
  setActiveStorageLogin("glossary-discovery-success-test");
  const team = state.teams[0];
  invokeHandler = async (command) => {
    if (command === "list_local_gtms_glossaries") {
      return [{
        glossaryId: "glossary-1",
        id: "glossary-1",
        repoName: "glossary-1",
        fullName: "team-1/glossary-1",
        title: "Team 1 Glossary",
      }];
    }
    if (command === "sync_local_team_metadata_repo" || command === "ensure_local_team_metadata_repo") {
      return null;
    }
    if (command === "list_local_gnosis_glossary_metadata_records") {
      return [{
        id: "glossary-1",
        glossaryId: "glossary-1",
        repoName: "glossary-1",
        fullName: "team-1/glossary-1",
        title: "Team 1 Glossary",
        defaultBranch: "main",
        lifecycleState: "active",
        remoteState: "linked",
        recordState: "live",
      }];
    }
    if (command === "inspect_and_migrate_local_repo_bindings") {
      return { issues: [], autoRepairedCount: 0 };
    }
    if (command === "list_gnosis_glossaries_for_installation") {
      return [{
        glossaryId: "glossary-1",
        name: "glossary-1",
        fullName: "team-1/glossary-1",
        defaultBranchName: "main",
      }];
    }
    if (command === "sync_gtms_glossary_repos") {
      return [{
        repoName: "glossary-1",
        status: "syncError",
        message: "Could not sync glossary repo glossary-1.",
      }];
    }
    return null;
  };

  await loadTeamGlossaries(() => {}, team.id);

  const queryData = queryClient.getQueryData(["glossaries", team.id]);
  const stored = loadStoredGlossariesForTeam(team);
  assert.deepEqual(state.glossaries.map((glossary) => glossary.id), ["glossary-1"]);
  assert.deepEqual(queryData?.glossaries?.map((glossary) => glossary.id), ["glossary-1"]);
  assert.deepEqual(stored.glossaries.map((glossary) => glossary.id), ["glossary-1"]);
  assert.equal(getNoticeBadgeText(), "Could not sync glossary repo glossary-1.");
  assert.equal(state.glossaryDiscovery.status, "ready");
  assert.equal(state.glossariesPage.isRefreshing, false);
});

test("an expired session during the remote listing routes to the sign-in screen", async () => {
  setupGlossaryLoadState();
  invokeHandler = async (command) => {
    if (command === "list_gnosis_glossaries_for_installation") {
      throw new Error("AUTH_REQUIRED:Your GitHub session expired. Please log in with GitHub again to continue.");
    }
    if (command === "inspect_and_migrate_local_repo_bindings") {
      return { issues: [], autoRepairedCount: 0 };
    }
    return null;
  };

  await loadTeamGlossaries(() => {}, "team-1");

  assert.equal(state.screen, "start");
  assert.equal(state.auth.status, "expired");
  assert.equal(state.auth.session, null);
});
