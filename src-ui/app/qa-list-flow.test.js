import test from "node:test";
import assert from "node:assert/strict";

let invokeHandler = async () => null;
const invokeCalls = [];

globalThis.document = {
  querySelector() {
    return null;
  },
};

globalThis.window = {
  __TAURI__: {
    core: {
      invoke: (command, payload) => {
        invokeCalls.push({ command, payload });
        return invokeHandler(command, payload);
      },
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

const {
  loadSelectedQaListEditorData,
  loadTeamQaLists,
  maybeApplyQaListEditorSnapshot,
  deleteQaList,
  importQaListFile,
  openQaListEditor,
  openQaListPermanentDeletion,
  openQaListRename,
  openEditorQaList,
  restoreQaList,
  resolveDefaultQaListForLanguage,
  submitQaListCreation,
  submitQaTermEditor,
} = await import("./qa-list-flow.js");
const {
  loadRepoBackedQaListsForTeam,
  rebuildQaListLocalRepo,
  repairQaListRepoBinding,
} = await import("./qa-list-repo-flow.js");
const {
  addLocalHardDeleteTombstone,
  clearLocalHardDeleteTombstoneForResource,
} = await import("./local-hard-delete-store.js");
const { getNoticeBadgeText } = await import("./status-feedback.js");
const { setCachedQaListEditorPayload } = await import("./qa-list-editor-query.js");
const { resetQaListsQueryObserver } = await import("./qa-list-query.js");
const { queryClient } = await import("./query-client.js");
const { resetSessionState, state } = await import("./state.js");
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

async function flushAsyncWork() {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setImmediate(resolve));
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

function setupQaTeams() {
  resetSessionState();
  invokeCalls.length = 0;
  state.auth.session = { sessionToken: "token" };
  state.teams = [
    {
      id: "team-1",
      name: "Team 1",
      githubOrg: "team-1",
      installationId: 1,
      canDelete: true,
    },
    {
      id: "team-2",
      name: "Team 2",
      githubOrg: "team-2",
      installationId: 2,
      canDelete: true,
    },
  ];
  state.selectedTeamId = "team-1";
}

function repoBackedQaList(overrides = {}) {
  return {
    id: "qa-list-1",
    title: "Vietnamese QA",
    language: { code: "vi", name: "Vietnamese" },
    lifecycleState: "active",
    termCount: 1,
    terms: [
      {
        termId: "term-1",
        text: "old",
        notes: "old note",
        lifecycleState: "active",
      },
    ],
    repoName: "qa-list-vietnamese",
    fullName: "team-1/qa-list-vietnamese",
    defaultBranchName: "main",
    defaultBranchHeadOid: "head-1",
    ...overrides,
  };
}

test.afterEach(() => {
  resetQaListsQueryObserver();
  queryClient.clear();
  invokeHandler = async () => null;
  invokeCalls.length = 0;
  setActiveStorageLogin(null);
  resetSessionState();
});

test("resolveDefaultQaListForLanguage returns the active default for the target language", () => {
  setupQaTeams();
  state.qaLists = [
    repoBackedQaList({
      id: "qa-vi",
      language: { code: "vi", name: "Vietnamese" },
      lifecycleState: "active",
    }),
    repoBackedQaList({
      id: "qa-ja",
      language: { code: "ja", name: "Japanese" },
      lifecycleState: "active",
    }),
  ];

  assert.equal(resolveDefaultQaListForLanguage("vi")?.id, "qa-vi");
  assert.equal(resolveDefaultQaListForLanguage("ja")?.id, "qa-ja");
  assert.equal(resolveDefaultQaListForLanguage("es"), null);
});

test("stale QA list page load does not replace the newly selected team's visible data", async () => {
  setupQaTeams();
  const remoteStarted = deferred();
  const remoteRepos = deferred();

  invokeHandler = async (command) => {
    if (command === "list_gnosis_qa_lists_for_installation") {
      remoteStarted.resolve();
      return remoteRepos.promise;
    }
    if (command === "list_local_gtms_qa_lists") {
      return [
        {
          qaListId: "team-1-qa",
          repoName: "team-1-qa",
          title: "Team 1 QA",
          language: { code: "vi", name: "Vietnamese" },
          lifecycleState: "active",
          termCount: 0,
        },
      ];
    }
    return [];
  };

  const loadPromise = loadTeamQaLists(() => {}, "team-1");
  await remoteStarted.promise;

  state.selectedTeamId = "team-2";
  state.qaLists = [repoBackedQaList({ id: "team-2-qa", title: "Team 2 QA" })];
  remoteRepos.resolve([]);
  await loadPromise;

  assert.equal(state.selectedTeamId, "team-2");
  assert.deepEqual(state.qaLists.map((qaList) => qaList.title), ["Team 2 QA"]);
});

test("QA list page load marks the page refreshing until the refresh finishes", async () => {
  setupQaTeams();
  const remoteStarted = deferred();
  const remoteRepos = deferred();

  invokeHandler = async (command) => {
    if (command === "list_gnosis_qa_lists_for_installation") {
      remoteStarted.resolve();
      return remoteRepos.promise;
    }
    if (command === "list_local_gtms_qa_lists") {
      return [];
    }
    return [];
  };

  const loadPromise = loadTeamQaLists(() => {}, "team-1");
  await remoteStarted.promise;

  assert.equal(state.qaListsPage.isRefreshing, true);
  assert.equal(Number.isFinite(state.qaListsPage.refreshStartedAt), true);

  remoteRepos.resolve([]);
  await loadPromise;

  assert.equal(state.qaListsPage.isRefreshing, false);
  assert.equal(state.qaListsPage.refreshStartedAt, null);
});

test("repo-backed QA list load bootstraps remote repos that do not have metadata yet", async () => {
  setupQaTeams();
  const remoteRepo = {
    name: "qa-list-japanese",
    fullName: "team-1/qa-list-japanese",
    repoId: 22,
    nodeId: "repo-node-22",
    defaultBranchName: "main",
    defaultBranchHeadOid: "head-remote",
  };
  const syncedQaList = repoBackedQaList({
    id: "qa-list-japanese-id",
    title: "Japanese QA",
    language: { code: "ja", name: "Japanese" },
    repoName: remoteRepo.name,
    repoId: remoteRepo.repoId,
    nodeId: remoteRepo.nodeId,
    fullName: remoteRepo.fullName,
    defaultBranchHeadOid: remoteRepo.defaultBranchHeadOid,
  });
  let didSyncQaRepo = false;
  let metadataRecords = [];

  invokeHandler = async (command, payload) => {
    if (command === "list_local_gtms_qa_lists") {
      return didSyncQaRepo ? [syncedQaList] : [];
    }
    if (command === "list_gnosis_qa_lists_for_installation") {
      return [remoteRepo];
    }
    if (command === "list_local_gnosis_qa_list_metadata_records") {
      return metadataRecords;
    }
    if (command === "sync_gtms_qa_list_repos") {
      didSyncQaRepo = true;
      assert.deepEqual(
        payload.input.qaLists.map((qaList) => qaList.repoName),
        [remoteRepo.name],
      );
      return [{ repoName: remoteRepo.name, status: "upToDate" }];
    }
    if (command === "upsert_local_gnosis_qa_list_metadata_record") {
      metadataRecords = [{
        id: payload.input.qaListId,
        kind: "qaList",
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
        language: payload.input.language,
        termCount: payload.input.termCount,
      }];
      return { commitCreated: true };
    }
    return { commitCreated: false };
  };

  const result = await loadRepoBackedQaListsForTeam(state.teams[0]);

  assert.equal(didSyncQaRepo, true);
  assert.equal(result.qaLists.length, 1);
  assert.equal(result.qaLists[0].id, syncedQaList.id);
  assert.equal(result.qaLists[0].title, syncedQaList.title);
  assert.equal(
    invokeCalls.some((call) => call.command === "upsert_local_gnosis_qa_list_metadata_record"),
    true,
  );
});

test("repo-backed QA list load does not bootstrap repos tracked by deleted metadata", async () => {
  setupQaTeams();
  const remoteRepo = {
    name: "qa-list-deleted",
    fullName: "team-1/qa-list-deleted",
    repoId: 33,
    defaultBranchName: "main",
  };

  invokeHandler = async (command) => {
    if (command === "list_local_gtms_qa_lists") {
      return [];
    }
    if (command === "list_gnosis_qa_lists_for_installation") {
      return [remoteRepo];
    }
    if (command === "list_local_gnosis_qa_list_metadata_records") {
      return [{
        id: "qa-list-deleted-id",
        kind: "qaList",
        title: "Deleted QA",
        repoName: remoteRepo.name,
        previousRepoNames: [],
        githubRepoId: remoteRepo.repoId,
        fullName: remoteRepo.fullName,
        defaultBranch: "main",
        lifecycleState: "deleted",
        remoteState: "linked",
        recordState: "live",
        deletedAt: "2026-05-01T00:00:00.000Z",
        language: { code: "ja", name: "Japanese" },
        termCount: 0,
      }];
    }
    if (command === "sync_gtms_qa_list_repos") {
      assert.fail("deleted QA metadata should not allow remote bootstrap sync");
    }
    return { commitCreated: false };
  };

  const result = await loadRepoBackedQaListsForTeam(state.teams[0]);

  assert.equal(result.syncSnapshots.length, 0);
  assert.equal(result.qaLists.length, 1);
  assert.equal(result.qaLists[0].lifecycleState, "deleted");
});

test("repo-backed QA list load trusts restored metadata over local hard-delete tombstones", async () => {
  setupQaTeams();
  setActiveStorageLogin("qa-restore-metadata-test");

  const remoteRepo = {
    name: "qa-list-restored",
    fullName: "team-1/qa-list-restored",
    repoId: 44,
    defaultBranchName: "main",
    defaultBranchHeadOid: "remote-head",
  };
  const restoredRecord = {
    id: "qa-list-restored-id",
    kind: "qaList",
    title: "Restored QA",
    repoName: remoteRepo.name,
    previousRepoNames: [],
    githubRepoId: remoteRepo.repoId,
    fullName: remoteRepo.fullName,
    defaultBranch: "main",
    lifecycleState: "active",
    remoteState: "linked",
    recordState: "live",
    deletedAt: null,
    language: { code: "vi", name: "Vietnamese" },
    termCount: 0,
  };
  const tombstonedResource = {
    id: restoredRecord.id,
    qaListId: restoredRecord.id,
    repoName: remoteRepo.name,
    fullName: remoteRepo.fullName,
    lifecycleState: "deleted",
  };
  addLocalHardDeleteTombstone(state.teams[0], "qaList", tombstonedResource);

  let didSyncQaRepo = false;
  try {
    invokeHandler = async (command, payload = {}) => {
      if (command === "list_local_gtms_qa_lists") {
        return didSyncQaRepo
          ? [{
            qaListId: restoredRecord.id,
            title: restoredRecord.title,
            repoName: remoteRepo.name,
            fullName: remoteRepo.fullName,
            language: restoredRecord.language,
            lifecycleState: "active",
            termCount: 0,
          }]
          : [];
      }
      if (command === "list_gnosis_qa_lists_for_installation") {
        return [remoteRepo];
      }
      if (command === "sync_local_team_metadata_repo") {
        return { commitCreated: false };
      }
      if (command === "list_local_gnosis_qa_list_metadata_records") {
        return [restoredRecord];
      }
      if (command === "sync_gtms_qa_list_repos") {
        didSyncQaRepo = true;
        assert.deepEqual(
          payload.input.qaLists.map((qaList) => qaList.repoName),
          [remoteRepo.name],
        );
        return [{ repoName: remoteRepo.name, status: "upToDate" }];
      }
      return { commitCreated: false };
    };

    const result = await loadRepoBackedQaListsForTeam(state.teams[0]);

    assert.equal(didSyncQaRepo, true);
    assert.equal(result.syncSnapshots.length, 1);
    assert.equal(result.qaLists.length, 1);
    assert.equal(result.qaLists[0].id, restoredRecord.id);
    assert.equal(result.qaLists[0].lifecycleState, "active");
  } finally {
    clearLocalHardDeleteTombstoneForResource(state.teams[0], "qaList", tombstonedResource);
  }
});

test("repairQaListRepoBinding repairs the local binding and reloads QA lists", async () => {
  setupQaTeams();
  const team = state.teams[0];
  const qaList = repoBackedQaList();
  const repairedQaList = repoBackedQaList({ title: "Repaired QA" });
  state.qaLists = [qaList];
  let localListCalls = 0;

  invokeHandler = async (command, payload = {}) => {
    if (command === "repair_local_repo_binding") {
      assert.deepEqual(payload.input, {
        installationId: team.installationId,
        kind: "qaList",
        resourceId: qaList.id,
      });
      return null;
    }
    if (command === "list_local_gtms_qa_lists") {
      localListCalls += 1;
      return [repairedQaList];
    }
    if (command === "list_gnosis_qa_lists_for_installation") {
      return [];
    }
    if (command === "list_local_gnosis_qa_list_metadata_records") {
      return [];
    }
    if (command === "upsert_local_gnosis_qa_list_metadata_record") {
      return { commitCreated: true };
    }
    return { commitCreated: false };
  };

  await repairQaListRepoBinding(() => {}, team, qaList.id);

  assert.equal(localListCalls >= 1, true);
  assert.deepEqual(state.qaLists.map((item) => item.title), ["Repaired QA"]);
  assert.equal(getNoticeBadgeText(), "The QA list repo binding was repaired.");
});

test("rebuildQaListLocalRepo reloads QA lists without repairing metadata", async () => {
  setupQaTeams();
  const team = state.teams[0];
  const qaList = repoBackedQaList();
  const rebuiltQaList = repoBackedQaList({ title: "Rebuilt QA" });
  state.qaLists = [qaList];

  invokeHandler = async (command) => {
    if (command === "repair_local_repo_binding") {
      assert.fail("rebuild should not invoke the metadata repair command");
    }
    if (command === "list_local_gtms_qa_lists") {
      return [rebuiltQaList];
    }
    if (command === "list_gnosis_qa_lists_for_installation") {
      return [];
    }
    if (command === "list_local_gnosis_qa_list_metadata_records") {
      return [];
    }
    if (command === "upsert_local_gnosis_qa_list_metadata_record") {
      return { commitCreated: true };
    }
    return { commitCreated: false };
  };

  await rebuildQaListLocalRepo(() => {}, team, qaList.id);

  assert.deepEqual(state.qaLists.map((item) => item.title), ["Rebuilt QA"]);
});

test("editor QA navigation renders a loading editor before QA list discovery finishes", async () => {
  setupQaTeams();
  const remoteRepos = deferred();
  state.screen = "translate";
  state.editorChapter = {
    selectedTargetLanguageCode: "vi",
    fileTitle: "Chapter 1",
  };

  invokeHandler = async (command) => {
    if (command === "list_gnosis_qa_lists_for_installation") {
      return remoteRepos.promise;
    }
    if (command === "list_local_gtms_qa_lists") {
      return [];
    }
    return [];
  };

  const renderSnapshots = [];
  const openPromise = openEditorQaList(() => {
    renderSnapshots.push({
      screen: state.screen,
      status: state.qaListEditor.status,
      navigationSource: state.qaListEditor.navigationSource,
      languageCode: state.qaListEditor.language?.code,
    });
  });

  assert.equal(state.screen, "qaListEditor");
  assert.equal(state.qaListEditor.status, "loading");
  assert.equal(state.qaListEditor.navigationSource, "editor");
  assert.equal(state.qaListEditor.language?.code, "vi");
  assert.equal(
    renderSnapshots.some((snapshot) =>
      snapshot.screen === "qaListEditor"
      && snapshot.status === "loading"
      && snapshot.navigationSource === "editor"
      && snapshot.languageCode === "vi"),
    true,
  );

  remoteRepos.resolve([]);
  await openPromise;

  assert.equal(state.screen, "qa");
});

test("editor QA navigation opens the cached default QA list before editor data loads", async () => {
  setupQaTeams();
  const qaList = repoBackedQaList({ terms: [], termCount: 0 });
  const editorData = deferred();
  state.screen = "translate";
  state.editorChapter = {
    selectedTargetLanguageCode: "vi",
    fileTitle: "Chapter 1",
  };
  state.qaLists = [qaList];

  const editorDataStarted = deferred();
  invokeHandler = async (command) => {
    if (command === "sync_gtms_qa_list_editor_repo") {
      return null;
    }
    if (command === "load_gtms_qa_list_editor_data") {
      editorDataStarted.resolve();
      return editorData.promise;
    }
    return [];
  };

  const openPromise = openEditorQaList(() => {});

  assert.equal(state.screen, "qaListEditor");
  assert.equal(state.selectedQaListId, qaList.id);
  assert.equal(state.qaListEditor.status, "loading");
  assert.equal(state.qaListEditor.qaListId, qaList.id);
  assert.equal(state.qaListEditor.title, qaList.title);
  assert.equal(state.pageSync.status, "syncing");

  await editorDataStarted.promise;
  assert.equal(
    invokeCalls.some((call) => call.command === "sync_gtms_qa_list_editor_repo"),
    false,
  );

  editorData.resolve({
    qaListId: qaList.id,
    title: qaList.title,
    language: qaList.language,
    lifecycleState: "active",
    termCount: 0,
    terms: [],
  });
  await openPromise;

  assert.equal(state.qaListEditor.status, "ready");
});

test("opening a QA list editor applies the exact cached snapshot before disk reload finishes", async () => {
  setupQaTeams();
  const qaList = repoBackedQaList({ terms: [], termCount: 0 });
  state.qaLists = [qaList];
  setCachedQaListEditorPayload(state.teams[0], qaList, {
    qaListId: qaList.id,
    repoName: qaList.repoName,
    title: qaList.title,
    language: qaList.language,
    lifecycleState: "active",
    termCount: 1,
    terms: [
      {
        termId: "cached-term",
        text: "cached text",
        notes: "cached notes",
      },
    ],
  });
  const diskData = deferred();
  invokeHandler = async (command) => {
    if (command === "sync_gtms_qa_list_editor_repo") {
      return null;
    }
    if (command === "load_gtms_qa_list_editor_data") {
      return diskData.promise;
    }
    return null;
  };

  openQaListEditor(() => {}, qaList.id);

  assert.equal(state.qaListEditor.status, "ready");
  assert.equal(state.qaListEditor.terms[0]?.termId, "cached-term");

  diskData.resolve({
    qaListId: qaList.id,
    repoName: qaList.repoName,
    title: qaList.title,
    language: qaList.language,
    lifecycleState: "active",
    termCount: 1,
    terms: [
      {
        termId: "disk-term",
        text: "disk text",
        notes: "disk notes",
      },
    ],
  });
  await flushAsyncWork();
  await new Promise((resolve) => setTimeout(resolve, 450));

  assert.equal(state.qaListEditor.terms[0]?.termId, "disk-term");
});

test("QA list editor snapshot apply leaves visible terms alone while a QA term draft is open", () => {
  setupQaTeams();
  const qaList = repoBackedQaList();
  state.qaLists = [qaList];
  state.selectedQaListId = qaList.id;
  state.screen = "qaListEditor";
  state.qaListEditor = {
    status: "ready",
    qaListId: qaList.id,
    repoName: qaList.repoName,
    title: qaList.title,
    language: qaList.language,
    terms: qaList.terms,
  };
  state.qaTermEditor = {
    isOpen: true,
    qaListId: qaList.id,
    termId: "term-1",
    text: "draft",
    notes: "",
  };

  const result = maybeApplyQaListEditorSnapshot({
    qaListId: qaList.id,
    repoName: qaList.repoName,
    title: qaList.title,
    language: qaList.language,
    lifecycleState: "active",
    termCount: 1,
    terms: [
      {
        termId: "remote-term",
        text: "remote",
        notes: "remote notes",
      },
    ],
  }, {
    teamId: "team-1",
    installationId: 1,
    qaListId: qaList.id,
    repoName: qaList.repoName,
  }, () => {}, { showDeferredNotice: true });

  assert.equal(result.applied, false);
  assert.equal(result.reason, "open-draft");
  assert.equal(state.qaListEditor.terms[0]?.termId, "term-1");
});

test("stale QA list editor load does not overwrite a different selected team", async () => {
  setupQaTeams();
  const qaList = repoBackedQaList();
  const editorDataStarted = deferred();
  const editorData = deferred();
  state.qaLists = [qaList];
  state.selectedQaListId = qaList.id;
  state.screen = "qaListEditor";
  state.qaListEditor = {
    status: "loading",
    qaListId: qaList.id,
    title: "Original editor",
    terms: qaList.terms,
  };

  invokeHandler = async (command) => {
    if (command === "sync_gtms_qa_list_editor_repo") {
      return null;
    }
    if (command === "load_gtms_qa_list_editor_data") {
      editorDataStarted.resolve();
      return editorData.promise;
    }
    return null;
  };

  const loadPromise = loadSelectedQaListEditorData(() => {});
  await editorDataStarted.promise;

  state.selectedTeamId = "team-2";
  state.qaListEditor.title = "Team 2 editor";
  editorData.resolve({
    qaListId: qaList.id,
    title: "Stale Team 1 editor",
    language: qaList.language,
    lifecycleState: "active",
    termCount: 0,
    terms: [],
  });
  await loadPromise;

  assert.equal(state.selectedTeamId, "team-2");
  assert.equal(state.qaListEditor.title, "Team 2 editor");
});

test("QA term save rolls back the local commit when repo sync fails", async () => {
  setupQaTeams();
  const qaList = repoBackedQaList();
  state.qaLists = [qaList];
  state.selectedQaListId = qaList.id;
  state.screen = "qaListEditor";
  state.qaListEditor = {
    status: "ready",
    qaListId: qaList.id,
    title: qaList.title,
    language: qaList.language,
    terms: qaList.terms,
  };
  state.qaTermEditor = {
    isOpen: true,
    status: "idle",
    error: "",
    qaListId: qaList.id,
    termId: "term-1",
    text: "updated",
    notes: "updated note",
  };

  let syncCount = 0;
  invokeHandler = async (command) => {
    if (command === "sync_gtms_qa_list_repos") {
      syncCount += 1;
      return syncCount === 1
        ? [{ repoName: qaList.repoName, status: "upToDate" }]
        : [{ repoName: qaList.repoName, status: "syncError", message: "push failed" }];
    }
    if (command === "load_gtms_qa_list_editor_data") {
      return {
        qaListId: qaList.id,
        title: qaList.title,
        language: qaList.language,
        lifecycleState: "active",
        termCount: 1,
        terms: qaList.terms,
      };
    }
    if (command === "upsert_gtms_qa_list_term") {
      return {
        qaListId: qaList.id,
        termCount: 1,
        previousHeadSha: "head-before-save",
        term: {
          termId: "term-1",
          text: "updated",
          notes: "updated note",
          lifecycleState: "active",
        },
      };
    }
    if (command === "rollback_gtms_qa_list_term_upsert") {
      return null;
    }
    return null;
  };

  await submitQaTermEditor(() => {});

  assert.match(state.qaTermEditor.error, /push failed/);
  assert.match(state.qaTermEditor.error, /rolled back/);
  assert.equal(
    invokeCalls.some((call) => call.command === "rollback_gtms_qa_list_term_upsert"),
    true,
  );
  assert.equal(state.qaListEditor.terms[0].text, "old");
  assert.equal(state.qaListEditor.terms[0].notes, "old note");
});

test("QA term save refuses to overwrite a term that changed during pre-save sync", async () => {
  setupQaTeams();
  const qaList = repoBackedQaList();
  state.qaLists = [qaList];
  state.selectedQaListId = qaList.id;
  state.screen = "qaListEditor";
  state.qaListEditor = {
    status: "ready",
    qaListId: qaList.id,
    title: qaList.title,
    language: qaList.language,
    terms: qaList.terms,
  };
  state.qaTermEditor = {
    isOpen: true,
    status: "idle",
    error: "",
    qaListId: qaList.id,
    termId: "term-1",
    text: "my draft",
    notes: "my note",
  };

  invokeHandler = async (command) => {
    if (command === "sync_gtms_qa_list_repos") {
      return [{ repoName: qaList.repoName, status: "upToDate" }];
    }
    if (command === "load_gtms_qa_list_editor_data") {
      return {
        qaListId: qaList.id,
        title: qaList.title,
        language: qaList.language,
        lifecycleState: "active",
        termCount: 1,
        terms: [
          {
            termId: "term-1",
            text: "remote edit",
            notes: "old note",
            lifecycleState: "active",
          },
        ],
      };
    }
    if (command === "upsert_gtms_qa_list_term") {
      assert.fail("stale QA term edits should not save before review");
    }
    return null;
  };

  await submitQaTermEditor(() => {});

  assert.match(state.qaTermEditor.error, /changed on GitHub/);
  assert.equal(state.qaListEditor.terms[0].text, "remote edit");
});

test("QA term save refuses duplicate text in the visible QA list", async () => {
  setupQaTeams();
  const qaList = repoBackedQaList();
  state.qaLists = [qaList];
  state.selectedQaListId = qaList.id;
  state.screen = "qaListEditor";
  state.qaListEditor = {
    status: "ready",
    qaListId: qaList.id,
    title: qaList.title,
    language: qaList.language,
    terms: qaList.terms,
  };
  state.qaTermEditor = {
    isOpen: true,
    status: "idle",
    error: "",
    qaListId: qaList.id,
    termId: null,
    text: "old",
    notes: "duplicate",
  };

  invokeHandler = async (command) => {
    if (
      command === "sync_gtms_qa_list_repos"
      || command === "load_gtms_qa_list_editor_data"
      || command === "upsert_gtms_qa_list_term"
    ) {
      assert.fail("duplicate QA terms should be rejected before saving");
    }
    return null;
  };

  await submitQaTermEditor(() => {});

  assert.equal(state.qaTermEditor.isOpen, true);
  assert.match(state.qaTermEditor.error, /redundant with another QA term in this QA list/);
  assert.equal(invokeCalls.some((call) => call.command === "upsert_gtms_qa_list_term"), false);
});

test("QA term save ignores the current term when checking duplicates", async () => {
  setupQaTeams();
  const qaList = {
    ...repoBackedQaList(),
    repoName: "",
    fullName: "",
  };
  state.qaLists = [qaList];
  state.selectedQaListId = qaList.id;
  state.screen = "qaListEditor";
  state.qaListEditor = {
    status: "ready",
    qaListId: qaList.id,
    title: qaList.title,
    language: qaList.language,
    terms: qaList.terms,
  };
  state.qaTermEditor = {
    isOpen: true,
    status: "idle",
    error: "",
    qaListId: qaList.id,
    termId: "term-1",
    text: "old",
    notes: "updated note",
  };

  await submitQaTermEditor(() => {});

  assert.equal(state.qaTermEditor.isOpen, false);
  assert.equal(state.qaListEditor.terms[0].text, "old");
  assert.equal(state.qaListEditor.terms[0].notes, "updated note");
});

test("QA term save refuses duplicate text found during pre-save sync", async () => {
  setupQaTeams();
  const qaList = repoBackedQaList({ terms: [], termCount: 0 });
  state.qaLists = [qaList];
  state.selectedQaListId = qaList.id;
  state.screen = "qaListEditor";
  state.qaListEditor = {
    status: "ready",
    qaListId: qaList.id,
    title: qaList.title,
    language: qaList.language,
    terms: [],
  };
  state.qaTermEditor = {
    isOpen: true,
    status: "idle",
    error: "",
    qaListId: qaList.id,
    termId: null,
    text: "<ruby>古い<rt>ふるい</rt></ruby>",
    notes: "duplicate after sync",
  };

  invokeHandler = async (command) => {
    if (command === "sync_gtms_qa_list_repos") {
      return [{ repoName: qaList.repoName, status: "upToDate" }];
    }
    if (command === "load_gtms_qa_list_editor_data") {
      return {
        qaListId: qaList.id,
        title: qaList.title,
        language: qaList.language,
        lifecycleState: "active",
        termCount: 1,
        terms: [
          {
            termId: "term-remote",
            text: "古い",
            notes: "already exists",
          },
        ],
      };
    }
    if (command === "upsert_gtms_qa_list_term") {
      assert.fail("duplicate QA terms should not save after pre-save sync");
    }
    return null;
  };

  await submitQaTermEditor(() => {});

  assert.equal(state.qaTermEditor.isOpen, true);
  assert.match(state.qaTermEditor.error, /redundant with another QA term in this QA list/);
  assert.equal(state.qaListEditor.terms[0].termId, "term-remote");
});

test("QA list lifecycle actions surface blocked states instead of mutating", async () => {
  setupQaTeams();
  state.qaLists = [
    repoBackedQaList(),
    repoBackedQaList({
      id: "deleted-qa-list",
      title: "Deleted Vietnamese QA",
      lifecycleState: "deleted",
      repoName: "qa-list-deleted",
      fullName: "team-1/qa-list-deleted",
    }),
  ];

  state.offline.isEnabled = true;
  openQaListRename(() => {}, "qa-list-1");
  assert.equal(state.qaListRename.isOpen, false);
  assert.match(getNoticeBadgeText(), /offline/i);

  await deleteQaList(() => {}, "qa-list-1");
  assert.equal(invokeCalls.length, 0);
  assert.match(getNoticeBadgeText(), /offline/i);

  await restoreQaList(() => {}, "deleted-qa-list");
  assert.equal(invokeCalls.length, 0);
  assert.match(getNoticeBadgeText(), /offline/i);

  state.offline.isEnabled = false;
  state.qaListsPage.isRefreshing = true;
  openQaListPermanentDeletion(() => {}, "deleted-qa-list");
  assert.equal(state.qaListPermanentDeletion.isOpen, false);
  assert.match(getNoticeBadgeText(), /current QA list refresh or write/i);
});

test("soft-deleting a QA list does not open a closed deleted QA lists section", async () => {
  setupQaTeams();
  state.qaLists = [repoBackedQaList()];
  state.showDeletedQaLists = false;

  await deleteQaList(() => {}, "qa-list-1");
  await flushAsyncWork();

  assert.equal(state.qaLists[0].lifecycleState, "deleted");
  assert.equal(state.showDeletedQaLists, false);
});

test("soft-deleting a QA list preserves a visible and already-open deleted QA lists section", async () => {
  setupQaTeams();
  state.qaLists = [
    repoBackedQaList(),
    repoBackedQaList({
      id: "deleted-qa-list",
      title: "Deleted QA",
      repoName: "qa-list-deleted",
      lifecycleState: "deleted",
    }),
  ];
  state.showDeletedQaLists = true;

  await deleteQaList(() => {}, "qa-list-1");
  await flushAsyncWork();

  assert.equal(state.qaLists.find((item) => item.id === "qa-list-1").lifecycleState, "deleted");
  assert.equal(state.showDeletedQaLists, true);
});

test("soft-deleting a QA list closes a stale open flag when the deleted section is not visible", async () => {
  setupQaTeams();
  state.qaLists = [repoBackedQaList()];
  state.showDeletedQaLists = true;

  await deleteQaList(() => {}, "qa-list-1");
  await flushAsyncWork();

  assert.equal(state.qaLists[0].lifecycleState, "deleted");
  assert.equal(state.showDeletedQaLists, false);
});

test("QA list creation rolls back remote and local repos when initialization fails", async () => {
  setupQaTeams();
  state.qaListCreation = {
    isOpen: true,
    status: "idle",
    error: "",
    title: "Vietnamese QA",
    languageCode: "vi",
  };

  invokeHandler = async (command) => {
    if (command === "list_local_gtms_qa_lists") {
      return [];
    }
    if (command === "create_gnosis_qa_list_repo") {
      return {
        name: "qa-list-vietnamese-qa",
        fullName: "team-1/qa-list-vietnamese-qa",
        defaultBranchName: "main",
      };
    }
    if (command === "initialize_gtms_qa_list_repo") {
      throw new Error("initialization failed");
    }
    return null;
  };

  await submitQaListCreation(() => {});

  assert.match(state.qaListCreation.error, /initialization failed/);
  assert.ok(invokeCalls.some((call) => call.command === "create_gnosis_qa_list_repo"));
  assert.ok(invokeCalls.some((call) => call.command === "prepare_local_gtms_qa_list_repo"));
  assert.ok(invokeCalls.some((call) => call.command === "rollback_created_gnosis_qa_list_repo"));
  assert.ok(invokeCalls.some((call) => call.command === "purge_local_gtms_qa_list_repo"));
});

test("QA list import rolls back remote and local repos when TMX import fails", async () => {
  setupQaTeams();
  const file = {
    name: "Vietnamese QA.tmx",
    async arrayBuffer() {
      return new Uint8Array([60, 116, 109, 120, 47, 62]).buffer;
    },
  };

  invokeHandler = async (command) => {
    if (command === "list_local_gtms_qa_lists") {
      return [];
    }
    if (command === "inspect_tmx_qa_list_import") {
      return {
        title: "Vietnamese QA",
        language: { code: "vi", name: "Vietnamese" },
        termCount: 1,
      };
    }
    if (command === "create_gnosis_qa_list_repo") {
      return {
        name: "qa-list-vietnamese-qa",
        fullName: "team-1/qa-list-vietnamese-qa",
        defaultBranchName: "main",
      };
    }
    if (command === "import_tmx_to_gtms_qa_list_repo") {
      throw new Error("import failed");
    }
    return null;
  };

  await importQaListFile(() => {}, file);

  assert.match(state.qaListImport.error, /import failed/);
  assert.ok(invokeCalls.some((call) => call.command === "create_gnosis_qa_list_repo"));
  assert.ok(invokeCalls.some((call) => call.command === "prepare_local_gtms_qa_list_repo"));
  assert.ok(invokeCalls.some((call) => call.command === "rollback_created_gnosis_qa_list_repo"));
  assert.ok(invokeCalls.some((call) => call.command === "purge_local_gtms_qa_list_repo"));
});
