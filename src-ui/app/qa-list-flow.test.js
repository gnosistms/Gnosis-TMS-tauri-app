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
  openQaListEditor,
  openEditorQaList,
  resolveDefaultQaListForLanguage,
  submitQaTermEditor,
} = await import("./qa-list-flow.js");
const { setCachedQaListEditorPayload } = await import("./qa-list-editor-query.js");
const { resetQaListsQueryObserver } = await import("./qa-list-query.js");
const { queryClient } = await import("./query-client.js");
const { resetSessionState, state } = await import("./state.js");

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
    },
    {
      id: "team-2",
      name: "Team 2",
      githubOrg: "team-2",
      installationId: 2,
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

  invokeHandler = async (command) => {
    if (command === "sync_gtms_qa_list_editor_repo") {
      return null;
    }
    if (command === "load_gtms_qa_list_editor_data") {
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
