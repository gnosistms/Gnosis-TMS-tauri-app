import test from "node:test";
import assert from "node:assert/strict";
import { installMockNavigator } from "../test/mock-navigator.mjs";

const cloneValue = (value) => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
};

const localStorageState = new Map();
let currentTime = 0;
let nextTimerId = 1;
let invokeHandler = async () => null;
const invokeLog = [];
const scheduledIntervals = new Map();
const scheduledTimeouts = new Map();

class FakeElement {
  closest() {
    return null;
  }

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
  }
}

class FakeHTMLElement extends FakeElement {}
class FakeHTMLInputElement extends FakeHTMLElement {}
class FakeHTMLSelectElement extends FakeHTMLElement {}
class FakeHTMLTextAreaElement extends FakeHTMLElement {}

const fakeApp = {
  addEventListener() {},
  firstElementChild: null,
  innerHTML: "",
};

function fakeSetInterval(callback) {
  const id = nextTimerId;
  nextTimerId += 1;
  scheduledIntervals.set(id, callback);
  return id;
}

function fakeClearInterval(id) {
  scheduledIntervals.delete(id);
}

function fakeSetTimeout(callback) {
  const id = nextTimerId;
  nextTimerId += 1;
  scheduledTimeouts.set(id, callback);
  callback();
  return id;
}

function fakeClearTimeout(id) {
  scheduledTimeouts.delete(id);
}

const fakeDocument = {
  querySelector(selector) {
    return selector === "#app" ? fakeApp : null;
  },
  querySelectorAll() {
    return [];
  },
  createElement() {
    return {
      className: "",
      hidden: false,
      style: {
        setProperty() {},
      },
      classList: {
        add() {},
        remove() {},
        toggle() {},
      },
      setAttribute() {},
      append() {},
      appendChild() {},
      replaceChildren() {},
      querySelector() {
        return null;
      },
    };
  },
  body: {
    append() {},
  },
  documentElement: {
    classList: {
      remove() {},
      toggle() {},
    },
  },
  addEventListener() {},
  hidden: false,
};

const fakeLocalStorage = {
  getItem(key) {
    return localStorageState.has(key) ? localStorageState.get(key) : null;
  },
  setItem(key, value) {
    localStorageState.set(key, String(value));
  },
  removeItem(key) {
    localStorageState.delete(key);
  },
  clear() {
    localStorageState.clear();
  },
  key(index) {
    return [...localStorageState.keys()][index] ?? null;
  },
  get length() {
    return localStorageState.size;
  },
};

globalThis.Element = FakeElement;
globalThis.HTMLElement = FakeHTMLElement;
globalThis.HTMLInputElement = FakeHTMLInputElement;
globalThis.HTMLSelectElement = FakeHTMLSelectElement;
globalThis.HTMLTextAreaElement = FakeHTMLTextAreaElement;
globalThis.document = fakeDocument;
globalThis.performance = {
  now() {
    return currentTime;
  },
};
globalThis.window = {
  __TAURI__: {
    core: {
      invoke(command, payload = {}) {
        invokeLog.push({
          command,
          payload: cloneValue(payload),
        });
        return invokeHandler(command, payload);
      },
    },
    event: {
      listen: async () => () => {},
    },
    opener: {
      openUrl() {},
    },
  },
  localStorage: fakeLocalStorage,
  navigator: {
    platform: "MacIntel",
    userAgentData: null,
  },
  setInterval: fakeSetInterval,
  clearInterval: fakeClearInterval,
  setTimeout: fakeSetTimeout,
  clearTimeout: fakeClearTimeout,
  requestAnimationFrame(callback) {
    callback();
    return 1;
  },
  open() {},
};
installMockNavigator(globalThis.window.navigator);

const {
  createQaListEditorState,
  createQaTermEditorState,
  resetSessionState,
  state,
} = await import("./state.js");
const {
  ensureQaTermReadyForEdit,
} = await import("./qa-term-sync.js");
const {
  applyQaListEditorPayload,
} = await import("./qa-list-shared.js");
const {
  markQaListBackgroundSyncDirty,
  maybeStartQaListBackgroundSync,
  qaListBackgroundSyncNeedsExitSync,
  startQaListBackgroundSyncSession,
  syncAndStopQaListBackgroundSyncSession,
} = await import("./qa-background-sync.js");
const {
  openQaTermEditor,
  submitQaTermEditor,
} = await import("./qa-term-draft.js");
const {
  maybeApplyQaListEditorSnapshot,
  openQaListEditor,
} = await import("./qa-list-editor-flow.js");
const {
  setCachedQaListEditorPayload,
} = await import("./qa-list-editor-query.js");
const { resetQaTermWriteCoordinator } = await import("./qa-term-write-coordinator.js");
const { queryClient } = await import("./query-client.js");

function qaTerm(overrides = {}) {
  return {
    termId: "term-1",
    text: "old",
    notes: "old note",
    lifecycleState: "active",
    freshness: "fresh",
    remotelyDeleted: false,
    ...overrides,
  };
}

function installQaListEditorFixture(options = {}) {
  const terms = Array.isArray(options.terms)
    ? options.terms
    : [
        qaTerm({ termId: "term-1", text: "old", notes: "old note" }),
        qaTerm({ termId: "term-2", text: "second", notes: "second note" }),
      ];

  resetSessionState();
  state.auth.session = {
    sessionToken: "session-token",
    login: "fixture-user",
  };
  state.selectedTeamId = "team-1";
  state.teams = [
    {
      id: "team-1",
      name: "Fixture Team",
      githubOrg: "fixture-org",
      installationId: 7,
      membershipRole: "owner",
      accountType: "organization",
    },
  ];
  state.selectedQaListId = "qa-list-1";
  state.qaLists = [
    {
      id: "qa-list-1",
      qaListId: "qa-list-1",
      repoName: "qa-list-1",
      title: "Fixture QA List",
      language: { code: "fr", name: "French" },
      lifecycleState: "active",
      termCount: terms.length,
      fullName: "fixture-org/qa-list-1",
      defaultBranchName: "main",
      defaultBranchHeadOid: "remote-head-1",
      repoId: 42,
      terms: cloneValue(terms),
    },
  ];
  state.screen = "qaListEditor";
  state.qaListEditor = {
    ...createQaListEditorState(),
    status: "ready",
    qaListId: "qa-list-1",
    repoName: "qa-list-1",
    repoId: 42,
    fullName: "fixture-org/qa-list-1",
    defaultBranchName: "main",
    defaultBranchHeadOid: "remote-head-1",
    title: "Fixture QA List",
    language: { code: "fr", name: "French" },
    lifecycleState: "active",
    termCount: terms.length,
    terms: cloneValue(terms),
  };
  state.qaTermEditor = createQaTermEditorState();
}

async function flushAsyncWork() {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setImmediate(resolve));
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve();
  }
}

function syncInvocationCount(command) {
  return invokeLog.filter((entry) => entry.command === command).length;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function qaEditorPayload(overrides = {}) {
  return {
    qaListId: "qa-list-1",
    repoName: "qa-list-1",
    title: "Fixture QA List",
    language: { code: "fr", name: "French" },
    lifecycleState: "active",
    termCount: 2,
    terms: [
      qaTerm({ termId: "term-1", text: "old", notes: "old note" }),
      qaTerm({ termId: "term-2", text: "second", notes: "second note" }),
    ],
    ...overrides,
  };
}

test.beforeEach(async () => {
  invokeLog.length = 0;
  scheduledIntervals.clear();
  scheduledTimeouts.clear();
  localStorageState.clear();
  currentTime = 0;
  nextTimerId = 1;
  invokeHandler = async () => null;
  resetSessionState();
  queryClient.clear();
  resetQaTermWriteCoordinator();
  await syncAndStopQaListBackgroundSyncSession(() => {});
});

test("opening a QA list editor applies the exact cached snapshot before disk reload finishes", async () => {
  installQaListEditorFixture({ terms: [] });
  state.offline.isEnabled = true;
  const qaList = state.qaLists[0];
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
        notes: "cached note",
      },
    ],
  });
  const diskLoad = deferred();
  invokeHandler = async (command) => {
    if (command === "load_gtms_qa_list_editor_data") {
      return diskLoad.promise;
    }
    if (command === "sync_gtms_qa_list_editor_repo") {
      return {
        oldHeadSha: "head-1",
        newHeadSha: "head-1",
        changedTermIds: [],
        insertedTermIds: [],
        deletedTermIds: [],
      };
    }
    return null;
  };

  const openPromise = openQaListEditor(() => {}, qaList.id, { preferredQaList: qaList });

  assert.equal(state.qaListEditor.status, "ready");
  assert.equal(state.qaListEditor.terms[0]?.termId, "cached-term");

  diskLoad.resolve(qaEditorPayload({
    termCount: 1,
    terms: [
      {
        termId: "disk-term",
        text: "disk text",
        notes: "disk note",
      },
    ],
  }));
  await openPromise;

  assert.equal(state.qaListEditor.terms[0]?.termId, "disk-term");
});

test("QA list editor snapshot apply leaves visible terms alone while a QA term draft is open", () => {
  installQaListEditorFixture();
  state.qaTermEditor = {
    ...createQaTermEditorState(),
    isOpen: true,
    qaListId: "qa-list-1",
  };

  const result = maybeApplyQaListEditorSnapshot(qaEditorPayload({
    termCount: 1,
    terms: [
      {
        termId: "remote-term",
        text: "remote",
        notes: "remote note",
      },
    ],
  }), {
    teamId: "team-1",
    installationId: 7,
    qaListId: "qa-list-1",
    repoName: "qa-list-1",
  }, () => {}, { showDeferredNotice: true });

  assert.equal(result.applied, false);
  assert.equal(result.reason, "open-draft");
  assert.equal(state.qaListEditor.terms[0]?.termId, "term-1");
});

test("QA list background sync marks changed terms stale without replacing the snapshot", async () => {
  installQaListEditorFixture();
  invokeHandler = async (command) => {
    if (command === "sync_gtms_qa_list_editor_repo") {
      return {
        oldHeadSha: "head-1",
        newHeadSha: "head-2",
        changedTermIds: ["term-2"],
        insertedTermIds: [],
        deletedTermIds: [],
      };
    }
    return null;
  };

  startQaListBackgroundSyncSession(() => {});
  await flushAsyncWork();

  assert.equal(syncInvocationCount("sync_gtms_qa_list_editor_repo"), 1);
  assert.equal(state.qaListEditor.terms.find((term) => term.termId === "term-1")?.freshness, "fresh");
  assert.equal(state.qaListEditor.terms.find((term) => term.termId === "term-2")?.freshness, "stale");
});

test("QA list editor payload preserves repo metadata needed for background sync", async () => {
  installQaListEditorFixture();
  invokeHandler = async (command) => {
    if (command === "sync_gtms_qa_list_editor_repo") {
      return {
        oldHeadSha: "head-1",
        newHeadSha: "head-2",
        changedTermIds: [],
        insertedTermIds: [],
        deletedTermIds: [],
      };
    }
    return null;
  };

  applyQaListEditorPayload({
    qaListId: "qa-list-1",
    title: "Fixture QA List",
    language: { code: "fr", name: "French" },
    lifecycleState: "active",
    termCount: 1,
    terms: [
      {
        termId: "term-1",
        text: "old",
        notes: "old note",
      },
    ],
  });

  startQaListBackgroundSyncSession(() => {});
  await flushAsyncWork();

  assert.equal(state.qaLists[0]?.fullName, "fixture-org/qa-list-1");
  assert.equal(state.qaListEditor.fullName, "fixture-org/qa-list-1");
  assert.equal(syncInvocationCount("sync_gtms_qa_list_editor_repo"), 1);
});

test("QA list background sync skips non-forced sync while the QA term editor is open", async () => {
  installQaListEditorFixture();
  invokeHandler = async (command) => {
    if (command === "sync_gtms_qa_list_editor_repo") {
      return {
        oldHeadSha: "head-1",
        newHeadSha: "head-1",
        changedTermIds: [],
        insertedTermIds: [],
        deletedTermIds: [],
      };
    }
    return null;
  };

  startQaListBackgroundSyncSession(() => {});
  await flushAsyncWork();

  invokeLog.length = 0;
  currentTime = 20_000;
  state.qaTermEditor = {
    ...createQaTermEditorState(),
    isOpen: true,
  };

  const didSync = await maybeStartQaListBackgroundSync(() => {});

  assert.equal(didSync, false);
  assert.equal(syncInvocationCount("sync_gtms_qa_list_editor_repo"), 0);
});

test("QA list exit sync stays inactive when the session has no local edits", async () => {
  installQaListEditorFixture();
  invokeHandler = async (command) => {
    if (command === "sync_gtms_qa_list_editor_repo") {
      return {
        oldHeadSha: "head-1",
        newHeadSha: "head-1",
        changedTermIds: [],
        insertedTermIds: [],
        deletedTermIds: [],
      };
    }
    return null;
  };

  startQaListBackgroundSyncSession(() => {});
  await flushAsyncWork();
  invokeLog.length = 0;

  assert.equal(qaListBackgroundSyncNeedsExitSync(), false);

  await syncAndStopQaListBackgroundSyncSession(() => {});

  assert.equal(syncInvocationCount("sync_gtms_qa_list_editor_repo"), 0);
});

test("QA list exit sync runs after a local QA list edit", async () => {
  installQaListEditorFixture();
  invokeHandler = async (command) => {
    if (command === "sync_gtms_qa_list_editor_repo") {
      return {
        oldHeadSha: "head-1",
        newHeadSha: "head-1",
        changedTermIds: [],
        insertedTermIds: [],
        deletedTermIds: [],
      };
    }
    return null;
  };

  startQaListBackgroundSyncSession(() => {});
  await flushAsyncWork();
  invokeLog.length = 0;

  markQaListBackgroundSyncDirty();

  assert.equal(qaListBackgroundSyncNeedsExitSync(), true);

  await syncAndStopQaListBackgroundSyncSession(() => {});

  assert.equal(syncInvocationCount("sync_gtms_qa_list_editor_repo"), 1);
});

test("opening a stale QA term reloads the latest term from disk before edit", async () => {
  installQaListEditorFixture({
    terms: [
      qaTerm({
        termId: "term-1",
        text: "old text",
        notes: "old note",
        freshness: "stale",
      }),
    ],
  });
  let renderCount = 0;
  invokeHandler = async (command, payload) => {
    if (command === "load_gtms_qa_list_term") {
      assert.equal(payload?.input?.termId, "term-1");
      return {
        termId: "term-1",
        term: {
          termId: "term-1",
          text: "new text",
          notes: "fresh note",
          lifecycleState: "active",
        },
      };
    }
    return null;
  };

  const term = await ensureQaTermReadyForEdit(() => {
    renderCount += 1;
  }, "term-1");

  assert.equal(term?.text, "new text");
  assert.equal(term?.notes, "fresh note");
  assert.equal(renderCount, 1);
  assert.deepEqual(
    state.qaListEditor.terms.map((entry) => ({
      termId: entry.termId,
      text: entry.text,
      notes: entry.notes,
      freshness: entry.freshness,
    })),
    [
      {
        termId: "term-1",
        text: "new text",
        notes: "fresh note",
        freshness: undefined,
      },
    ],
  );
});

test("opening an existing QA term uses the local term snapshot immediately", () => {
  installQaListEditorFixture({
    terms: [
      qaTerm({
        termId: "term-1",
        text: "current text",
        notes: "current note",
      }),
    ],
  });

  const renderStates = [];
  invokeHandler = async (command) => {
    assert.fail(`unexpected command during local QA term open: ${command}`);
    return null;
  };

  openQaTermEditor(() => {
    renderStates.push({
      isOpen: state.qaTermEditor.isOpen,
      termId: state.qaTermEditor.termId,
      text: state.qaTermEditor.text,
      notes: state.qaTermEditor.notes,
    });
  }, "term-1");

  assert.equal(state.qaTermEditor.isOpen, true);
  assert.equal(state.qaTermEditor.termId, "term-1");
  assert.equal(state.qaTermEditor.text, "current text");
  assert.equal(state.qaTermEditor.notes, "current note");
  assert.deepEqual(renderStates, [
    {
      isOpen: true,
      termId: "term-1",
      text: "current text",
      notes: "current note",
    },
  ]);

  assert.equal(syncInvocationCount("sync_gtms_qa_list_editor_repo"), 0);
  assert.equal(syncInvocationCount("load_gtms_qa_list_term"), 0);
});

test("saving a QA term with a newer GitHub version keeps the modal open with a banner", async () => {
  installQaListEditorFixture({
    terms: [
      qaTerm({
        termId: "term-1",
        text: "local text",
        notes: "local note",
      }),
    ],
  });
  state.qaTermEditor = {
    ...createQaTermEditorState(),
    isOpen: true,
    qaListId: "qa-list-1",
    termId: "term-1",
    text: "edited text",
    notes: "edited note",
  };

  invokeHandler = async (command) => {
    if (command === "sync_gtms_qa_list_repos") {
      return [{ repoName: "qa-list-1", status: "upToDate" }];
    }
    if (command === "load_gtms_qa_list_editor_data") {
      return qaEditorPayload({
        termCount: 1,
        terms: [
          {
            termId: "term-1",
            text: "github text",
            notes: "github note",
          },
        ],
      });
    }
    if (command === "upsert_gtms_qa_list_term") {
      assert.fail("stale QA terms should not save before the latest GitHub version loads");
    }
    return null;
  };

  await submitQaTermEditor(() => {});

  assert.equal(state.qaTermEditor.isOpen, true);
  assert.match(state.qaTermEditor.error, /changed on GitHub/);
  assert.equal(state.qaTermEditor.text, "edited text");
  assert.equal(state.qaListEditor.terms[0]?.text, "github text");
});

test("saving a QA term rolls back the local commit when the later GitHub sync fails", async () => {
  installQaListEditorFixture({
    terms: [
      qaTerm({
        termId: "term-1",
        text: "server text",
        notes: "server note",
      }),
    ],
  });
  state.qaTermEditor = {
    ...createQaTermEditorState(),
    isOpen: true,
    qaListId: "qa-list-1",
    termId: "term-1",
    text: "edited text",
    notes: "edited note",
  };

  let syncCount = 0;
  invokeHandler = async (command) => {
    switch (command) {
      case "sync_gtms_qa_list_repos":
        syncCount += 1;
        return syncCount === 1
          ? [{ repoName: "qa-list-1", status: "upToDate" }]
          : [{ repoName: "qa-list-1", status: "syncError", message: "GitHub sync failed." }];
      case "load_gtms_qa_list_editor_data":
        return qaEditorPayload({
          termCount: 1,
          terms: [
            {
              termId: "term-1",
              text: "server text",
              notes: "server note",
            },
          ],
        });
      case "upsert_gtms_qa_list_term":
        return {
          qaListId: "qa-list-1",
          termCount: 1,
          previousHeadSha: "head-1",
          term: {
            termId: "term-1",
            text: "edited text",
            notes: "edited note",
            lifecycleState: "active",
          },
        };
      case "rollback_gtms_qa_list_term_upsert":
        return null;
      default:
        return null;
    }
  };

  await submitQaTermEditor(() => {});

  const upsertIndex = invokeLog.findIndex((entry) => entry.command === "upsert_gtms_qa_list_term");
  const rollbackIndex = invokeLog.findIndex((entry) => entry.command === "rollback_gtms_qa_list_term_upsert");
  assert.ok(upsertIndex >= 0);
  assert.ok(rollbackIndex > upsertIndex);
  assert.equal(state.qaTermEditor.isOpen, true);
  assert.match(state.qaTermEditor.error, /GitHub sync failed\./);
  assert.match(state.qaTermEditor.error, /rolled back/i);
  assert.equal(state.qaListEditor.terms[0]?.text, "server text");
});

test("saving a QA term closes the modal and patches the visible row before forced sync finishes", async () => {
  installQaListEditorFixture({
    terms: [
      qaTerm({
        termId: "term-1",
        text: "server text",
        notes: "server note",
      }),
    ],
  });
  startQaListBackgroundSyncSession(() => {});
  await flushAsyncWork();
  invokeLog.length = 0;
  state.qaTermEditor = {
    ...createQaTermEditorState(),
    isOpen: true,
    qaListId: "qa-list-1",
    termId: "term-1",
    text: "optimistic text",
    notes: "optimistic note",
  };

  const releaseBackgroundSync = deferred();
  let editorSyncCount = 0;
  invokeHandler = async (command, payload) => {
    switch (command) {
      case "sync_gtms_qa_list_repos":
        return [{ repoName: "qa-list-1", status: "upToDate" }];
      case "load_gtms_qa_list_editor_data":
        return qaEditorPayload({
          termCount: 1,
          terms: [
            {
              termId: "term-1",
              text: "server text",
              notes: "server note",
            },
          ],
        });
      case "upsert_gtms_qa_list_term":
        return {
          qaListId: "qa-list-1",
          termCount: 1,
          term: {
            termId: "term-1",
            text: payload.input.text,
            notes: payload.input.notes,
            lifecycleState: "active",
          },
        };
      case "sync_gtms_qa_list_editor_repo":
        editorSyncCount += 1;
        if (editorSyncCount > 1) {
          await releaseBackgroundSync.promise;
        }
        return {
          oldHeadSha: "head-1",
          newHeadSha: "head-1",
          changedTermIds: [],
          insertedTermIds: [],
          deletedTermIds: [],
        };
      default:
        return null;
    }
  };

  const savePromise = submitQaTermEditor(() => {});
  await flushAsyncWork();

  assert.equal(state.qaTermEditor.isOpen, false);
  assert.equal(state.qaListEditor.terms[0]?.text, "optimistic text");
  assert.equal(syncInvocationCount("upsert_gtms_qa_list_term"), 1);

  releaseBackgroundSync.resolve();
  await savePromise;
});

test("stale QA term reload ignores responses after switching to another QA list", async () => {
  installQaListEditorFixture({
    terms: [
      qaTerm({
        termId: "term-1",
        text: "old text",
        notes: "old note",
        freshness: "stale",
      }),
    ],
  });

  let notifyLoadStarted = null;
  const loadStarted = new Promise((resolve) => {
    notifyLoadStarted = resolve;
  });
  let resolveResponse = null;
  const loadResponse = new Promise((resolve) => {
    resolveResponse = resolve;
  });
  invokeHandler = async (command) => {
    if (command === "load_gtms_qa_list_term") {
      notifyLoadStarted?.();
      return await loadResponse;
    }
    return null;
  };

  const pendingTerm = ensureQaTermReadyForEdit(() => {}, "term-1");
  await loadStarted;

  state.selectedQaListId = "qa-list-2";
  state.qaLists = [
    {
      id: "qa-list-2",
      repoName: "qa-list-2",
      title: "Other QA List",
      language: { code: "de", name: "German" },
      lifecycleState: "active",
      termCount: 1,
      fullName: "fixture-org/qa-list-2",
      defaultBranchName: "main",
      defaultBranchHeadOid: "remote-head-2",
      repoId: 43,
    },
  ];
  state.qaListEditor = {
    ...createQaListEditorState(),
    status: "ready",
    qaListId: "qa-list-2",
    repoName: "qa-list-2",
    repoId: 43,
    fullName: "fixture-org/qa-list-2",
    defaultBranchName: "main",
    defaultBranchHeadOid: "remote-head-2",
    title: "Other QA List",
    language: { code: "de", name: "German" },
    lifecycleState: "active",
    termCount: 1,
    terms: [
      qaTerm({
        termId: "term-9",
        text: "other text",
        notes: "other note",
      }),
    ],
  };

  resolveResponse?.({
    termId: "term-1",
    term: {
      termId: "term-1",
      text: "new text",
      notes: "new note",
      lifecycleState: "active",
    },
  });

  const term = await pendingTerm;

  assert.equal(term, null);
  assert.deepEqual(
    state.qaListEditor.terms.map((entry) => entry.termId),
    ["term-9"],
  );
});

test("saving a QA term syncs first and then persists the user's modal draft", async () => {
  installQaListEditorFixture({
    terms: [
      qaTerm({
        termId: "term-1",
        text: "server text",
        notes: "server note",
      }),
    ],
  });
  state.qaTermEditor = {
    ...createQaTermEditorState(),
    isOpen: true,
    qaListId: "qa-list-1",
    termId: "term-1",
    text: "local text",
    notes: "local note",
  };

  let capturedUpsertInput = null;
  invokeHandler = async (command, payload) => {
    switch (command) {
      case "sync_gtms_qa_list_repos":
        return [{ repoName: "qa-list-1", status: "upToDate" }];
      case "load_gtms_qa_list_editor_data":
        return qaEditorPayload({
          termCount: 1,
          terms: [
            {
              termId: "term-1",
              text: capturedUpsertInput?.text ?? "server text",
              notes: capturedUpsertInput?.notes ?? "server note",
            },
          ],
        });
      case "upsert_gtms_qa_list_term":
        capturedUpsertInput = cloneValue(payload?.input);
        return {
          qaListId: "qa-list-1",
          termCount: 1,
          term: {
            termId: "term-1",
            text: capturedUpsertInput.text,
            notes: capturedUpsertInput.notes,
            lifecycleState: "active",
          },
        };
      case "sync_gtms_qa_list_editor_repo":
        return {
          oldHeadSha: "head-1",
          newHeadSha: "head-1",
          changedTermIds: [],
          insertedTermIds: [],
          deletedTermIds: [],
        };
      default:
        return null;
    }
  };

  await submitQaTermEditor(() => {});

  const syncIndex = invokeLog.findIndex((entry) => entry.command === "sync_gtms_qa_list_repos");
  const upsertIndex = invokeLog.findIndex((entry) => entry.command === "upsert_gtms_qa_list_term");

  assert.ok(syncIndex >= 0);
  assert.ok(upsertIndex > syncIndex);
  assert.deepEqual(capturedUpsertInput, {
    installationId: 7,
    repoName: "qa-list-1",
    qaListId: "qa-list-1",
    termId: "term-1",
    text: "local text",
    notes: "local note",
  });
  assert.equal(state.qaTermEditor.isOpen, false);
  assert.equal(state.qaListEditor.terms[0]?.text, "local text");
});

test("saving a QA term sanitizes ruby markup and escapes unsupported inline formatting", async () => {
  installQaListEditorFixture({
    terms: [
      qaTerm({
        termId: "term-1",
        text: "server text",
        notes: "server note",
      }),
    ],
  });
  state.qaTermEditor = {
    ...createQaTermEditorState(),
    isOpen: true,
    qaListId: "qa-list-1",
    termId: "term-1",
    text: "<ruby>漢字<rt>かんじ</rt></ruby><strong>bold</strong>",
    notes: "plain note",
  };

  let capturedUpsertInput = null;
  invokeHandler = async (command, payload) => {
    switch (command) {
      case "sync_gtms_qa_list_repos":
        return [{ repoName: "qa-list-1", status: "upToDate" }];
      case "load_gtms_qa_list_editor_data":
        return qaEditorPayload({
          termCount: 1,
          terms: [
            {
              termId: "term-1",
              text: capturedUpsertInput?.text ?? "server text",
              notes: capturedUpsertInput?.notes ?? "server note",
            },
          ],
        });
      case "upsert_gtms_qa_list_term":
        capturedUpsertInput = cloneValue(payload?.input);
        return {
          qaListId: "qa-list-1",
          termCount: 1,
          term: {
            termId: "term-1",
            text: capturedUpsertInput.text,
            notes: capturedUpsertInput.notes,
            lifecycleState: "active",
          },
        };
      case "sync_gtms_qa_list_editor_repo":
        return {
          oldHeadSha: "head-1",
          newHeadSha: "head-1",
          changedTermIds: [],
          insertedTermIds: [],
          deletedTermIds: [],
        };
      default:
        return null;
    }
  };

  await submitQaTermEditor(() => {});

  assert.equal(
    capturedUpsertInput?.text,
    "<ruby>漢字<rt>かんじ</rt></ruby>&lt;strong&gt;bold&lt;/strong&gt;",
  );
  assert.equal(state.qaListEditor.terms[0]?.text, capturedUpsertInput?.text);
});

test("QA list background sync opens a required update prompt when the repo was saved by a newer app", async () => {
  installQaListEditorFixture();

  invokeHandler = async (command) => {
    if (command === "sync_gtms_qa_list_editor_repo") {
      throw new Error(
        "APP_UPDATE_REQUIRED:{\"requiredVersion\":\"0.1.36\",\"currentVersion\":\"0.1.35\",\"message\":\"Update before syncing this QA list.\"}",
      );
    }
    return null;
  };

  startQaListBackgroundSyncSession(() => {});
  await flushAsyncWork();

  const synced = await maybeStartQaListBackgroundSync(() => {}, { force: true });

  assert.equal(synced, false);
  assert.equal(state.appUpdate.required, true);
  assert.equal(state.appUpdate.promptVisible, true);
  assert.equal(state.appUpdate.version, "0.1.36");
  assert.equal(state.appUpdate.currentVersion, "0.1.35");
  assert.equal(state.appUpdate.message, "Update before syncing this QA list.");
});
