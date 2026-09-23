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
  createGlossaryEditorState,
  createGlossaryTermEditorState,
  resetSessionState,
  createAppUpdateState,
  state,
} = await import("./state.js");
const {
  ensureGlossaryTermReadyForEdit,
} = await import("./glossary-term-sync.js");
const {
  applyGlossaryEditorPayload,
} = await import("./glossary-shared.js");
const {
  glossaryBackgroundSyncNeedsExitSync,
  markGlossaryBackgroundSyncDirty,
  maybeStartGlossaryBackgroundSync,
  startGlossaryBackgroundSyncSession,
  syncAndStopGlossaryBackgroundSyncSession,
} = await import("./glossary-background-sync.js");
const {
  openGlossaryTermEditor,
  submitGlossaryTermEditor,
  updateGlossaryTermVariant,
  moveGlossaryTermVariantToIndex,
  removeGlossaryTermVariant,
} = await import("./glossary-term-draft.js");
const {
  deleteGlossaryTerm,
  loadSelectedGlossaryEditorData,
  maybeApplyGlossaryEditorSnapshot,
  openGlossaryEditor,
  primeSelectedGlossaryEditorLoadingState,
} = await import("./glossary-editor-flow.js");
const {
  setCachedGlossaryEditorPayload,
} = await import("./glossary-editor-query.js");
const {
  anyGlossaryTermWriteIsActive,
  resetGlossaryTermWriteCoordinator,
} = await import("./glossary-term-write-coordinator.js");
const { queryClient, teamKeys } = await import("./query-client.js");
const { createNavigationActions } = await import("./actions/navigation-actions.js");
const { createGlossaryEditorQueryOptions } = await import("./glossary-editor-query.js");
const { createQaListEditorQueryOptions } = await import("./qa-list-editor-query.js");
const { applyQaListEditorPayload } = await import("./qa-list-shared.js");

function glossaryTerm(overrides = {}) {
  return {
    termId: "term-1",
    sourceTerms: ["uno"],
    targetTerms: ["mot"],
    notesToTranslators: "",
    footnote: "",
    untranslated: false,
    lifecycleState: "active",
    freshness: "fresh",
    remotelyDeleted: false,
    ...overrides,
  };
}

function installGlossaryEditorFixture(options = {}) {
  const terms = Array.isArray(options.terms)
    ? options.terms
    : [
        glossaryTerm({ termId: "term-1", sourceTerms: ["uno"], targetTerms: ["mot"] }),
        glossaryTerm({ termId: "term-2", sourceTerms: ["dos"], targetTerms: ["deux"] }),
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
      githubOrg: "fixture-org",
      installationId: 7,
      canManageProjects: true,
      accountType: "organization",
    },
  ];
  state.selectedGlossaryId = "glossary-1";
  state.glossaries = [
    {
      id: "glossary-1",
      repoName: "glossary-1",
      title: "Fixture Glossary",
      sourceLanguage: { code: "es", name: "Spanish" },
      targetLanguage: { code: "fr", name: "French" },
      lifecycleState: "active",
      termCount: terms.length,
      fullName: "fixture-org/glossary-1",
      defaultBranchName: "main",
      defaultBranchHeadOid: "remote-head-1",
      repoId: 42,
    },
  ];
  state.screen = "glossaryEditor";
  state.glossaryEditor = {
    ...createGlossaryEditorState(),
    status: "ready",
    glossaryId: "glossary-1",
    repoName: "glossary-1",
    title: "Fixture Glossary",
    sourceLanguage: { code: "es", name: "Spanish" },
    targetLanguage: { code: "fr", name: "French" },
    lifecycleState: "active",
    termCount: terms.length,
    terms: cloneValue(terms),
  };
  state.glossaryTermEditor = createGlossaryTermEditorState();
  // Keep access refresh from treating the fixture's default null IPC response as
  // an authoritative empty team list during navigation tests.
  queryClient.setQueryData(teamKeys.currentUser("fixture-user"), {
    items: cloneValue(state.teams), deletedItems: [], authLogin: "fixture-user",
  });
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

async function waitForGlossaryTermWrites() {
  for (let index = 0; index < 20; index += 1) {
    await flushAsyncWork();
    if (!anyGlossaryTermWriteIsActive()) {
      return;
    }
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

test.afterEach(() => queryClient.clear());

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
  resetGlossaryTermWriteCoordinator();
  await syncAndStopGlossaryBackgroundSyncSession(() => {});
});

test("opening a glossary editor applies the exact cached snapshot before disk reload finishes", async () => {
  installGlossaryEditorFixture({ terms: [] });
  state.offline.isEnabled = true;
  const glossary = state.glossaries[0];
  setCachedGlossaryEditorPayload(state.teams[0], glossary, {
    glossaryId: glossary.id,
    repoName: glossary.repoName,
    title: glossary.title,
    sourceLanguage: glossary.sourceLanguage,
    targetLanguage: glossary.targetLanguage,
    lifecycleState: "active",
    termCount: 1,
    terms: [
      {
        termId: "cached-term",
        sourceTerms: ["cached source"],
        targetTerms: ["cached target"],
      },
    ],
  });
  const diskLoad = deferred();
  invokeHandler = async (command) => {
    if (command === "load_gtms_glossary_editor_data") {
      return diskLoad.promise;
    }
    if (
      command === "list_team_metadata_records"
      || command === "get_current_user_team_access"
    ) {
      return [];
    }
    return null;
  };

  const openPromise = openGlossaryEditor(() => {}, glossary.id, { preferredGlossary: glossary });

  assert.equal(state.glossaryEditor.status, "ready");
  assert.equal(state.glossaryEditor.terms[0]?.termId, "cached-term");

  diskLoad.resolve({
    glossaryId: glossary.id,
    repoName: glossary.repoName,
    title: glossary.title,
    sourceLanguage: glossary.sourceLanguage,
    targetLanguage: glossary.targetLanguage,
    lifecycleState: "active",
    termCount: 1,
    terms: [
      {
        termId: "disk-term",
        sourceTerms: ["disk source"],
        targetTerms: ["disk target"],
      },
    ],
  });
  await openPromise;

  assert.equal(state.glossaryEditor.terms[0]?.termId, "disk-term");
});

test("glossary editor snapshot apply leaves visible terms alone while a term draft is open", () => {
  installGlossaryEditorFixture();
  state.glossaryTermEditor = {
    ...createGlossaryTermEditorState(),
    isOpen: true,
    glossaryId: "glossary-1",
  };

  const result = maybeApplyGlossaryEditorSnapshot({
    glossaryId: "glossary-1",
    repoName: "glossary-1",
    title: "Fixture Glossary",
    sourceLanguage: { code: "es", name: "Spanish" },
    targetLanguage: { code: "fr", name: "French" },
    lifecycleState: "active",
    termCount: 1,
    terms: [
      {
        termId: "remote-term",
        sourceTerms: ["remote"],
        targetTerms: ["distant"],
      },
    ],
  }, {
    teamId: "team-1",
    installationId: 7,
    glossaryId: "glossary-1",
    repoName: "glossary-1",
  }, () => {}, { showDeferredNotice: true });

  assert.equal(result.applied, false);
  assert.equal(result.reason, "open-draft");
  assert.equal(state.glossaryEditor.terms[0]?.termId, "term-1");
});

for (const entry of ["open", "navigation"]) {
  for (const outcome of ["saved", "failed"]) {
    test(`returning to the glossary via ${entry} preserves the list during a term save (${outcome})`, async () => {
      installGlossaryEditorFixture();
      const diskPayload = cloneValue(state.glossaryEditor);
      const save = deferred();
      invokeHandler = async (command) => {
        if (command === "upsert_gtms_glossary_term") return save.promise;
        if (command === "load_gtms_glossary_editor_data") return diskPayload;
        if (command === "sync_gtms_glossary_repos") return [];
        return null;
      };
      await openGlossaryTermEditor(() => {}, "term-1");
      state.glossaryTermEditor.targetTerms = ["edited target"];
      await submitGlossaryTermEditor(() => {});
      await flushAsyncWork();
      assert.equal(anyGlossaryTermWriteIsActive(), true);
      assert.equal(syncInvocationCount("upsert_gtms_glossary_term"), 1);

      await syncAndStopGlossaryBackgroundSyncSession(() => {});
      state.screen = "translate";
      const renderedStates = [];
      const render = () => renderedStates.push(cloneValue(state.glossaryEditor));
      if (entry === "open") {
        await openGlossaryEditor(render, "glossary-1", { navigationSource: "editor" });
      } else {
        primeSelectedGlossaryEditorLoadingState({ navigationSource: "editor" });
        state.screen = "glossaryEditor";
        await loadSelectedGlossaryEditorData(render);
      }
      assert.equal(state.glossaryEditor.status, "ready");
      assert.equal(state.glossaryEditor.terms.length, 2);
      assert.deepEqual(state.glossaryEditor.terms[0].targetTerms, ["edited target"]);
      assert.equal(state.glossaryEditor.terms[0].pendingMutation, "save");
      assert.ok(renderedStates.every((editor) => editor.status === "ready" && editor.terms.length === 2));

      if (outcome === "saved") {
        save.resolve({ term: glossaryTerm({ targetTerms: ["edited target"] }), termCount: 2 });
      } else {
        save.reject(new Error("Save failed"));
      }
      await waitForGlossaryTermWrites();
      assert.equal(anyGlossaryTermWriteIsActive(), false);
      assert.equal(state.glossaryEditor.status, "ready");
      assert.equal(state.glossaryEditor.terms.length, 2);
      assert.deepEqual(state.glossaryEditor.terms[0].targetTerms, outcome === "saved" ? ["edited target"] : ["mot"]);
      assert.equal(state.glossaryEditor.terms[0].pendingMutation, null);
      if (outcome === "failed") {
        assert.equal(state.glossaryTermEditor.isOpen, true);
        assert.deepEqual(state.glossaryTermEditor.targetTerms, ["edited target"]);
        assert.match(state.glossaryTermEditor.error, /Save failed/);
      }
    });
  }
}

test("priming a different glossary clears the previous glossary terms", () => {
  installGlossaryEditorFixture();
  state.glossaries.push({ ...state.glossaries[0], id: "glossary-2", repoName: "glossary-2" });
  state.selectedGlossaryId = "glossary-2";
  primeSelectedGlossaryEditorLoadingState();
  assert.equal(state.glossaryEditor.status, "loading");
  assert.equal(state.glossaryEditor.glossaryId, "glossary-2");
  assert.deepEqual(state.glossaryEditor.terms, []);
});

test("glossary reload keeps ready terms visible while background sync defers the snapshot", async () => {
  installGlossaryEditorFixture();
  const terms = cloneValue(state.glossaryEditor.terms);
  const sync = deferred();
  invokeHandler = async (command) => {
    if (command === "sync_gtms_glossary_editor_repo") return sync.promise;
    if (command === "load_gtms_glossary_editor_data") {
      return { glossaryId: "glossary-1", terms: [] };
    }
    return null;
  };
  const syncing = maybeStartGlossaryBackgroundSync(() => {}, { force: true });
  primeSelectedGlossaryEditorLoadingState();
  await loadSelectedGlossaryEditorData(() => {});
  assert.equal(state.glossaryEditor.status, "ready");
  assert.deepEqual(state.glossaryEditor.terms, terms);
  sync.resolve({ changedTermIds: ["term-1"] });
  await syncing;
  assert.equal(state.glossaryEditor.status, "ready");
  assert.equal(state.glossaryEditor.terms[0].freshness, "stale");
});

test("glossary background sync marks changed terms stale without replacing the snapshot", async () => {
  installGlossaryEditorFixture();
  invokeHandler = async (command) => {
    if (command === "sync_gtms_glossary_editor_repo") {
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

  startGlossaryBackgroundSyncSession(() => {});
  await flushAsyncWork();

  assert.equal(syncInvocationCount("sync_gtms_glossary_editor_repo"), 1);
  assert.equal(state.glossaryEditor.terms.find((term) => term.termId === "term-1")?.freshness, "fresh");
  assert.equal(state.glossaryEditor.terms.find((term) => term.termId === "term-2")?.freshness, "stale");
});

test("glossary editor payload preserves repo metadata needed for background sync", async () => {
  installGlossaryEditorFixture();
  invokeHandler = async (command) => {
    if (command === "sync_gtms_glossary_editor_repo") {
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

  applyGlossaryEditorPayload({
    glossaryId: "glossary-1",
    title: "Fixture Glossary",
    sourceLanguage: { code: "es", name: "Spanish" },
    targetLanguage: { code: "fr", name: "French" },
    lifecycleState: "active",
    termCount: 2,
    terms: [
      {
        termId: "term-1",
        sourceTerms: ["uno"],
        targetTerms: ["mot"],
        notesToTranslators: "",
        footnote: "",
        untranslated: false,
        lifecycleState: "active",
      },
    ],
  });

  startGlossaryBackgroundSyncSession(() => {});
  await flushAsyncWork();

  assert.equal(state.glossaries[0]?.fullName, "fixture-org/glossary-1");
  assert.equal(state.glossaryEditor.fullName, "fixture-org/glossary-1");
  assert.equal(syncInvocationCount("sync_gtms_glossary_editor_repo"), 1);
});

test("glossary background sync skips non-forced sync while the term editor is open", async () => {
  installGlossaryEditorFixture();
  invokeHandler = async (command) => {
    if (command === "sync_gtms_glossary_editor_repo") {
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

  startGlossaryBackgroundSyncSession(() => {});
  await flushAsyncWork();

  invokeLog.length = 0;
  currentTime = 20_000;
  state.glossaryTermEditor = {
    ...createGlossaryTermEditorState(),
    isOpen: true,
  };

  const didSync = await maybeStartGlossaryBackgroundSync(() => {});

  assert.equal(didSync, false);
  assert.equal(syncInvocationCount("sync_gtms_glossary_editor_repo"), 0);
});

test("glossary exit sync stays inactive when the session has no local edits", async () => {
  installGlossaryEditorFixture();
  invokeHandler = async (command) => {
    if (command === "sync_gtms_glossary_editor_repo") {
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

  startGlossaryBackgroundSyncSession(() => {});
  await flushAsyncWork();
  invokeLog.length = 0;

  assert.equal(glossaryBackgroundSyncNeedsExitSync(), false);

  await syncAndStopGlossaryBackgroundSyncSession(() => {});

  assert.equal(syncInvocationCount("sync_gtms_glossary_editor_repo"), 0);
});

test("glossary exit sync runs after a local glossary edit", async () => {
  installGlossaryEditorFixture();
  invokeHandler = async (command) => {
    if (command === "sync_gtms_glossary_editor_repo") {
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

  startGlossaryBackgroundSyncSession(() => {});
  await flushAsyncWork();
  invokeLog.length = 0;

  markGlossaryBackgroundSyncDirty();

  assert.equal(glossaryBackgroundSyncNeedsExitSync(), true);

  await syncAndStopGlossaryBackgroundSyncSession(() => {});

  assert.equal(syncInvocationCount("sync_gtms_glossary_editor_repo"), 1);
});

test("opening a stale glossary term reloads the latest term from disk before edit", async () => {
  installGlossaryEditorFixture({
    terms: [
      glossaryTerm({
        termId: "term-1",
        sourceTerms: ["old source"],
        targetTerms: ["old target"],
        freshness: "stale",
      }),
    ],
  });
  let renderCount = 0;
  invokeHandler = async (command, payload) => {
    if (command === "load_gtms_glossary_term") {
      assert.equal(payload?.input?.termId, "term-1");
      return {
        termId: "term-1",
        term: {
          termId: "term-1",
          sourceTerms: ["new source"],
          targetTerms: ["new target"],
          notesToTranslators: "fresh notes",
          footnote: "",
          untranslated: false,
          lifecycleState: "active",
        },
      };
    }
    return null;
  };

  const term = await ensureGlossaryTermReadyForEdit(() => {
    renderCount += 1;
  }, "term-1");

  assert.deepEqual(term?.sourceTerms, ["new source"]);
  assert.deepEqual(term?.targetTerms, ["new target"]);
  assert.equal(term?.freshness, "fresh");
  assert.equal(term?.remotelyDeleted, false);
  assert.equal(renderCount, 1);
  assert.deepEqual(
    state.glossaryEditor.terms.map((entry) => ({
      termId: entry.termId,
      sourceTerms: entry.sourceTerms,
      targetTerms: entry.targetTerms,
      freshness: entry.freshness,
    })),
    [
      {
        termId: "term-1",
        sourceTerms: ["new source"],
        targetTerms: ["new target"],
        freshness: "fresh",
      },
    ],
  );
});

test("opening an existing glossary term uses the local term snapshot immediately", async () => {
  installGlossaryEditorFixture({
    terms: [
      glossaryTerm({
        termId: "term-1",
        sourceTerms: ["current source"],
        targetTerms: ["current target"],
      }),
    ],
  });

  const renderStates = [];
  invokeHandler = async (command) => {
    assert.fail(`unexpected command during local glossary term open: ${command}`);
    return null;
  };

  await openGlossaryTermEditor(() => {
    renderStates.push({
      isOpen: state.glossaryTermEditor.isOpen,
      status: state.glossaryTermEditor.status,
      termId: state.glossaryTermEditor.termId,
      sourceTerms: [...state.glossaryTermEditor.sourceTerms],
      targetTerms: [...state.glossaryTermEditor.targetTerms],
    });
  }, "term-1");

  assert.equal(state.glossaryTermEditor.isOpen, true);
  assert.equal(state.glossaryTermEditor.status, "idle");
  assert.equal(state.glossaryTermEditor.termId, "term-1");
  assert.deepEqual(state.glossaryTermEditor.sourceTerms, ["current source"]);
  assert.deepEqual(state.glossaryTermEditor.targetTerms, ["current target"]);
  assert.deepEqual(renderStates, [
    {
      isOpen: true,
      status: "idle",
      termId: "term-1",
      sourceTerms: ["current source"],
      targetTerms: ["current target"],
    },
  ]);

  assert.equal(syncInvocationCount("sync_gtms_glossary_editor_repo"), 0);
  assert.equal(syncInvocationCount("load_gtms_glossary_term"), 0);
});

test("saving a glossary term with a newer GitHub version reloads the latest term and reopens the modal with a banner", async () => {
  installGlossaryEditorFixture({
    terms: [
      glossaryTerm({
        termId: "term-1",
        sourceTerms: ["local source"],
        targetTerms: ["local target"],
      }),
    ],
  });
  state.glossaryTermEditor = {
    ...createGlossaryTermEditorState(),
    isOpen: true,
    glossaryId: "glossary-1",
    termId: "term-1",
    sourceTerms: ["edited source"],
    targetTerms: ["edited target"],
    notesToTranslators: "edited notes",
    footnote: "edited footnote",
    untranslated: false,
  };

  invokeHandler = async (command, payload) => {
    if (command === "sync_gtms_glossary_editor_repo") {
      return {
        oldHeadSha: "head-1",
        newHeadSha: "head-2",
        changedTermIds: ["term-1"],
        insertedTermIds: [],
        deletedTermIds: [],
      };
    }
    if (command === "load_gtms_glossary_term") {
      assert.equal(payload?.input?.termId, "term-1");
      return {
        termId: "term-1",
        term: {
          termId: "term-1",
          sourceTerms: ["github source"],
          targetTerms: ["github target"],
          notesToTranslators: "github notes",
          footnote: "github footnote",
          untranslated: false,
          lifecycleState: "active",
        },
      };
    }
    if (command === "upsert_gtms_glossary_term") {
      assert.fail("stale glossary terms should not save before the latest GitHub version loads");
    }
    return null;
  };

  await submitGlossaryTermEditor(() => {});
  await waitForGlossaryTermWrites();

  assert.equal(state.glossaryTermEditor.isOpen, true);
  assert.equal(state.glossaryTermEditor.status, "idle");
  assert.equal(
    state.glossaryTermEditor.notice,
    "Error: this glossary term has a more recent version on GitHub. Please redo your edits and save again.",
  );
  assert.deepEqual(state.glossaryTermEditor.sourceTerms, ["github source"]);
  assert.deepEqual(state.glossaryTermEditor.targetTerms, ["github target"]);
  assert.deepEqual(state.glossaryTermEditor.notesToTranslators, "github notes");
  assert.deepEqual(state.glossaryTermEditor.footnote, "github footnote");
});

test("saving a glossary term rolls back the local commit when the later GitHub sync fails", async () => {
  installGlossaryEditorFixture({
    terms: [
      glossaryTerm({
        termId: "term-1",
        sourceTerms: ["server source"],
        targetTerms: ["server target"],
      }),
    ],
  });
  state.glossaryTermEditor = {
    ...createGlossaryTermEditorState(),
    isOpen: true,
    glossaryId: "glossary-1",
    termId: "term-1",
    sourceTerms: ["edited source"],
    targetTerms: ["edited target"],
    notesToTranslators: "edited notes",
    footnote: "edited footnote",
    untranslated: false,
  };

  invokeHandler = async (command) => {
    switch (command) {
      case "sync_gtms_glossary_editor_repo":
        return {
          oldHeadSha: "head-1",
          newHeadSha: "head-1",
          changedTermIds: [],
          insertedTermIds: [],
          deletedTermIds: [],
        };
      case "upsert_gtms_glossary_term":
        return {
          glossaryId: "glossary-1",
          termCount: 1,
          previousHeadSha: "head-1",
          term: {
            termId: "term-1",
            sourceTerms: ["edited source"],
            targetTerms: ["edited target"],
            notesToTranslators: "edited notes",
            footnote: "edited footnote",
            untranslated: false,
            lifecycleState: "active",
          },
        };
      case "sync_gtms_glossary_repos":
        return [
          {
            repoName: "glossary-1",
            status: "syncError",
            message: "GitHub sync failed.",
          },
        ];
      case "rollback_gtms_glossary_term_upsert":
        return null;
      case "load_gtms_glossary_editor_data":
        return {
          glossaryId: "glossary-1",
          title: "Fixture Glossary",
          sourceLanguage: { code: "es", name: "Spanish" },
          targetLanguage: { code: "fr", name: "French" },
          lifecycleState: "active",
          termCount: 1,
          terms: [
            {
              termId: "term-1",
              sourceTerms: ["server source"],
              targetTerms: ["server target"],
              notesToTranslators: "",
              footnote: "",
              untranslated: false,
              lifecycleState: "active",
            },
          ],
        };
      default:
        return null;
    }
  };

  await submitGlossaryTermEditor(() => {});
  await waitForGlossaryTermWrites();

  const upsertIndex = invokeLog.findIndex((entry) => entry.command === "upsert_gtms_glossary_term");
  const rollbackIndex = invokeLog.findIndex((entry) => entry.command === "rollback_gtms_glossary_term_upsert");
  assert.ok(upsertIndex >= 0);
  assert.ok(rollbackIndex > upsertIndex);
  assert.equal(state.glossaryTermEditor.isOpen, true);
  assert.equal(state.glossaryTermEditor.status, "idle");
  assert.match(state.glossaryTermEditor.error, /GitHub sync failed\./);
  assert.match(state.glossaryTermEditor.error, /rolled back/i);
  assert.deepEqual(state.glossaryTermEditor.sourceTerms, ["edited source"]);
  assert.deepEqual(state.glossaryTermEditor.targetTerms, ["edited target"]);
});

test("deleting a glossary term rolls back the local commit when sync fails", async () => {
  installGlossaryEditorFixture({ terms: [glossaryTerm()] });

  invokeHandler = async (command) => {
    switch (command) {
      case "delete_gtms_glossary_term":
        return {
          glossaryId: "glossary-1",
          termId: "term-1",
          termCount: 0,
          previousHeadSha: "head-before-delete",
        };
      case "sync_gtms_glossary_repos":
        return [
          {
            repoName: "glossary-1",
            status: "syncError",
            message: "GitHub delete sync failed.",
          },
        ];
      case "rollback_gtms_glossary_term_upsert":
        return null;
      default:
        return null;
    }
  };

  await deleteGlossaryTerm(() => {}, "term-1");

  const deleteIndex = invokeLog.findIndex(
    (entry) => entry.command === "delete_gtms_glossary_term",
  );
  const rollbackIndex = invokeLog.findIndex(
    (entry) => entry.command === "rollback_gtms_glossary_term_upsert",
  );
  assert.ok(deleteIndex >= 0);
  assert.ok(rollbackIndex > deleteIndex);
  assert.equal(
    invokeLog[rollbackIndex]?.payload?.input?.previousHeadSha,
    "head-before-delete",
  );
  assert.equal(state.glossaryEditor.terms.some((term) => term.termId === "term-1"), true);
});

test("saving a glossary term closes the modal and patches the visible row before forced sync finishes", async () => {
  installGlossaryEditorFixture({
    terms: [
      glossaryTerm({
        termId: "term-1",
        sourceTerms: ["server source"],
        targetTerms: ["server target"],
      }),
    ],
  });
  state.glossaryTermEditor = {
    ...createGlossaryTermEditorState(),
    isOpen: true,
    glossaryId: "glossary-1",
    termId: "term-1",
    sourceTerms: ["optimistic source"],
    targetTerms: ["optimistic target"],
    notesToTranslators: "",
    footnote: "",
    untranslated: false,
  };

  const releaseSync = deferred();
  const releaseRepoSync = deferred();
  invokeHandler = async (command, payload) => {
    switch (command) {
      case "sync_gtms_glossary_editor_repo":
        await releaseSync.promise;
        return {
          oldHeadSha: "head-1",
          newHeadSha: "head-1",
          changedTermIds: [],
          insertedTermIds: [],
          deletedTermIds: [],
        };
      case "upsert_gtms_glossary_term":
        return {
          glossaryId: "glossary-1",
          termCount: 1,
          term: {
            termId: "term-1",
            sourceTerms: payload.input.sourceTerms,
            targetTerms: payload.input.targetTerms,
            notesToTranslators: "",
            footnote: "",
            untranslated: false,
            lifecycleState: "active",
          },
        };
      case "sync_gtms_glossary_repos":
        await releaseRepoSync.promise;
        return [];
      default:
        return null;
    }
  };

  await submitGlossaryTermEditor(() => {});
  await flushAsyncWork();

  assert.equal(state.glossaryTermEditor.isOpen, false);
  assert.deepEqual(state.glossaryEditor.terms[0]?.sourceTerms, ["optimistic source"]);
  assert.equal(state.glossaryEditor.terms[0]?.pendingMutation, "save");
  assert.equal(state.statusBadges.right.visible, true);
  assert.equal(state.statusBadges.right.scope, "glossaryEditor");
  assert.equal(state.statusBadges.right.text, "Checking remote glossary changes...");
  assert.equal(syncInvocationCount("upsert_gtms_glossary_term"), 0);

  releaseSync.resolve();
  await flushAsyncWork();

  assert.equal(syncInvocationCount("upsert_gtms_glossary_term"), 1);
  assert.equal(state.statusBadges.right.visible, true);
  assert.equal(state.statusBadges.right.scope, "glossaryEditor");
  assert.equal(state.statusBadges.right.text, "Syncing glossary repo...");

  releaseRepoSync.resolve();
  await waitForGlossaryTermWrites();

  assert.equal(state.glossaryEditor.terms[0]?.pendingMutation, null);
  assert.equal(state.statusBadges.right.visible, false);
  assert.equal(syncInvocationCount("load_gtms_glossary_editor_data"), 0);
});

test("stale glossary term reload ignores responses after switching to another glossary", async () => {
  installGlossaryEditorFixture({
    terms: [
      glossaryTerm({
        termId: "term-1",
        sourceTerms: ["old source"],
        targetTerms: ["old target"],
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
    if (command === "load_gtms_glossary_term") {
      notifyLoadStarted?.();
      return await loadResponse;
    }
    return null;
  };

  const pendingTerm = ensureGlossaryTermReadyForEdit(() => {}, "term-1");
  await loadStarted;

  state.selectedGlossaryId = "glossary-2";
  state.glossaries = [
    {
      id: "glossary-2",
      repoName: "glossary-2",
      title: "Other Glossary",
      sourceLanguage: { code: "en", name: "English" },
      targetLanguage: { code: "de", name: "German" },
      lifecycleState: "active",
      termCount: 1,
      fullName: "fixture-org/glossary-2",
      defaultBranchName: "main",
      defaultBranchHeadOid: "remote-head-2",
      repoId: 43,
    },
  ];
  state.glossaryEditor = {
    ...createGlossaryEditorState(),
    status: "ready",
    glossaryId: "glossary-2",
    repoName: "glossary-2",
    repoId: 43,
    fullName: "fixture-org/glossary-2",
    defaultBranchName: "main",
    defaultBranchHeadOid: "remote-head-2",
    title: "Other Glossary",
    sourceLanguage: { code: "en", name: "English" },
    targetLanguage: { code: "de", name: "German" },
    lifecycleState: "active",
    termCount: 1,
    terms: [
      glossaryTerm({
        termId: "term-9",
        sourceTerms: ["other source"],
        targetTerms: ["other target"],
      }),
    ],
  };

  resolveResponse?.({
    termId: "term-1",
    term: {
      termId: "term-1",
      sourceTerms: ["new source"],
      targetTerms: ["new target"],
      notesToTranslators: "",
      footnote: "",
      untranslated: false,
      lifecycleState: "active",
    },
  });

  const term = await pendingTerm;

  assert.equal(term, null);
  assert.deepEqual(
    state.glossaryEditor.terms.map((entry) => entry.termId),
    ["term-9"],
  );
});

test("saving a glossary term syncs first and then persists the user's modal draft", async () => {
  installGlossaryEditorFixture({
    terms: [
      glossaryTerm({
        termId: "term-1",
        sourceTerms: ["server source"],
        targetTerms: ["server target"],
      }),
    ],
  });
  state.glossaryTermEditor = {
    ...createGlossaryTermEditorState(),
    isOpen: true,
    glossaryId: "glossary-1",
    termId: "term-1",
    sourceTerms: ["local source"],
    targetTerms: ["local target overwrite"],
    targetVariantNotes: [""],
    notesToTranslators: "local note",
    footnote: "local footnote",
    untranslated: false,
  };

  let capturedUpsertInput = null;
  const renderCalls = [];
  invokeHandler = async (command, payload) => {
    switch (command) {
      case "ensure_local_team_metadata_repo":
        return null;
      case "lookup_local_team_metadata_tombstone":
        return false;
      case "sync_gtms_glossary_editor_repo":
        return {
          oldHeadSha: "head-1",
          newHeadSha: "head-1",
          changedTermIds: [],
          insertedTermIds: [],
          deletedTermIds: [],
        };
      case "upsert_gtms_glossary_term":
        capturedUpsertInput = cloneValue(payload?.input);
        return {
          glossaryId: "glossary-1",
          termCount: 1,
          term: {
            termId: "term-1",
            sourceTerms: capturedUpsertInput.sourceTerms,
            targetTerms: capturedUpsertInput.targetTerms,
            notesToTranslators: capturedUpsertInput.notesToTranslators,
            footnote: capturedUpsertInput.footnote,
            untranslated: capturedUpsertInput.untranslated,
            lifecycleState: "active",
          },
        };
      case "sync_gtms_glossary_repos":
        return [];
      case "load_gtms_glossary_editor_data":
        return {
          glossaryId: "glossary-1",
          title: "Fixture Glossary",
          sourceLanguage: { code: "es", name: "Spanish" },
          targetLanguage: { code: "fr", name: "French" },
          lifecycleState: "active",
          termCount: 1,
          terms: [
            {
              termId: "term-1",
              sourceTerms: capturedUpsertInput?.sourceTerms ?? [],
              targetTerms: capturedUpsertInput?.targetTerms ?? [],
              notesToTranslators: capturedUpsertInput?.notesToTranslators ?? "",
              footnote: capturedUpsertInput?.footnote ?? "",
              untranslated: capturedUpsertInput?.untranslated === true,
              lifecycleState: "active",
            },
          ],
        };
      default:
        return null;
    }
  };

  await submitGlossaryTermEditor(() => {
    renderCalls.push({
      modalStatus: state.glossaryTermEditor.status,
      termCount: state.glossaryEditor.termCount,
    });
  });
  await waitForGlossaryTermWrites();

  const syncIndex = invokeLog.findIndex((entry) => entry.command === "sync_gtms_glossary_editor_repo");
  const upsertIndex = invokeLog.findIndex((entry) => entry.command === "upsert_gtms_glossary_term");

  assert.ok(syncIndex >= 0);
  assert.ok(upsertIndex > syncIndex);
  assert.equal(syncInvocationCount("load_gtms_glossary_editor_data"), 0);
  assert.deepEqual(capturedUpsertInput, {
    installationId: 7,
    glossaryId: "glossary-1",
    repoName: "glossary-1",
    termId: "term-1",
    sourceTerms: ["local source"],
    targetTerms: ["local target overwrite"],
    targetVariantNotes: [""],
    notesToTranslators: "local note",
    footnote: "local footnote",
    untranslated: false,
  });
  assert.equal(state.glossaryTermEditor.isOpen, false);
  assert.deepEqual(state.glossaryEditor.terms[0]?.targetTerms, ["local target overwrite"]);
  assert.ok(renderCalls.length > 0);
});

for (const termId of [null, "term-1"]) {
  test(`backend duplicate rejection marks the recovered ${termId ? "edited" : "new"} draft and tracks variant changes`, async () => {
    installGlossaryEditorFixture();
    state.glossaryTermEditor = {
      ...createGlossaryTermEditorState(),
      isOpen: true,
      glossaryId: "glossary-1",
      termId,
      sourceTerms: ["Dag Dugpa", "Dag-Dugpa", 'Dugpa "quoted"'],
      targetTerms: ["Dag Dugpa"],
      footnote: "Keep this footnote.",
    };
    invokeHandler = async (command) => {
      if (command === "sync_gtms_glossary_editor_repo") return { changedTermIds: [] };
      if (command === "upsert_gtms_glossary_term") {
        throw new Error(`Remove or change these duplicate source variants before saving: ${JSON.stringify(["Dag-Dugpa", 'Dugpa "quoted"'])}`);
      }
      return null;
    };

    await submitGlossaryTermEditor(() => {});
    await waitForGlossaryTermWrites();

    assert.equal(syncInvocationCount("upsert_gtms_glossary_term"), 1);
    assert.equal(syncInvocationCount("sync_gtms_glossary_repos"), 0);
    assert.equal(state.glossaryTermEditor.isOpen, true);
    assert.equal(state.glossaryTermEditor.footnote, "Keep this footnote.");
    assert.equal(state.glossaryTermEditor.error, "");
    assert.deepEqual(state.glossaryTermEditor.redundantSourceVariantIndices, [1, 2]);
    assert.match(state.glossaryTermEditor.sourceTermDuplicateWarning, /marked variants/);
    assert.doesNotMatch(state.glossaryTermEditor.sourceTermDuplicateWarning, /below/);

    moveGlossaryTermVariantToIndex("source", 2, 0);
    assert.deepEqual(state.glossaryTermEditor.redundantSourceVariantIndices, [0, 2]);
    removeGlossaryTermVariant("source", 0);
    assert.deepEqual(state.glossaryTermEditor.redundantSourceVariantIndices, [1]);
    updateGlossaryTermVariant("source", 1, "Unique variant");
    assert.deepEqual(state.glossaryTermEditor.redundantSourceVariantIndices, []);
    assert.equal(state.glossaryTermEditor.sourceTermDuplicateWarning, "");
  });
}

for (const context of ["missing summary", "local summary without identity"]) {
  test(`chapter term navigation saves a footnote with ${context}`, async () => {
    installGlossaryEditorFixture();
    const terms = cloneValue(state.glossaryEditor.terms);
    const glossary = cloneValue(state.glossaries[0]);
    state.glossaries = context === "missing summary" ? [] : [{
      id: glossary.id, repoName: glossary.repoName, title: glossary.title,
    }];
    state.glossaryEditor = createGlossaryEditorState();
    state.selectedGlossaryId = null;
    state.screen = "translate";
    state.selectedChapterId = "chapter-1";
    state.projects = [{ id: "project-1", chapters: [{
      id: "chapter-1",
      linkedGlossary: { glossaryId: glossary.id, repoName: glossary.repoName },
    }] }];
    invokeHandler = async (command, payload) => {
      if (command === "load_gtms_glossary_editor_data") return {
        glossaryId: glossary.id, title: glossary.title, terms,
        lifecycleState: "active", termCount: terms.length,
      };
      if (command === "list_local_gnosis_glossary_metadata_records") {
        assert.equal(payload.installationId, 7);
        return [{
          id: glossary.id, repoName: glossary.repoName, title: glossary.title,
          fullName: "actual-owner/glossary-1", githubRepoId: 42,
          defaultBranch: "translation",
        }];
      }
      if (command === "sync_gtms_glossary_editor_repo") return {
        changedTermIds: [], insertedTermIds: [], deletedTermIds: [],
      };
      if (command === "upsert_gtms_glossary_term") return {
        term: glossaryTerm(payload.input),
      };
      if (command === "sync_gtms_glossary_repos") return [];
      return null;
    };

    await createNavigationActions(() => {})("open-editor-glossary-term:term-1");
    await flushAsyncWork();
    assert.equal(state.glossaryTermEditor.isOpen, true);
    assert.equal(state.glossaryTermEditor.termId, "term-1");
    state.glossaryTermEditor.footnote = "Updated footnote only.";
    await submitGlossaryTermEditor(() => {});
    await waitForGlossaryTermWrites();

    const saved = invokeLog.filter(entry => entry.command === "upsert_gtms_glossary_term");
    assert.equal(saved.length, 1, state.glossaryTermEditor.error);
    assert.equal(saved[0].payload.input.termId, "term-1");
    assert.equal(saved[0].payload.input.footnote, "Updated footnote only.");
    assert.deepEqual(saved[0].payload.input.sourceTerms, terms[0].sourceTerms);
    const syncInput = invokeLog.find(entry => entry.command === "sync_gtms_glossary_editor_repo").payload.input;
    assert.equal(syncInput.fullName, "actual-owner/glossary-1");
    assert.equal(syncInput.repoId, 42);
    assert.equal(syncInput.defaultBranchName, "translation");
    assert.equal(state.glossaryTermEditor.isOpen, false);
    assert.equal(state.glossaryEditor.terms.length, terms.length);
    assert.equal(state.glossaryEditor.terms[0].footnote, "Updated footnote only.");
  });
}

for (const [kind, queryOptions, command] of [
  ["glossary", createGlossaryEditorQueryOptions, "list_local_gnosis_glossary_metadata_records"],
  ["QA list", createQaListEditorQueryOptions, "list_local_gnosis_qa_list_metadata_records"],
]) {
  for (const mismatch of ["id", "repoName", "githubRepoId", "fullName"]) {
    test(`${kind} editor never hydrates identity from mismatched ${mismatch}`, async () => {
      installGlossaryEditorFixture();
      const resource = { id: "resource-1", repoName: "repo-1", repoId: 42 };
      invokeHandler = async (name) => name === command ? [{
        id: resource.id, repoName: resource.repoName, title: "Resource",
        fullName: "owner/repo-1", githubRepoId: 42,
        [mismatch]: mismatch === "githubRepoId" ? 43 : "other",
      }] : {};
      const load = queryOptions(state.teams[0], resource).queryFn();
      if (mismatch === "id") {
        assert.equal((await load).fullName, "");
      } else {
        await assert.rejects(load, /repository details have changed/);
      }
    });
  }
}

test("QA editor applies repository identity loaded from local metadata", async () => {
  installGlossaryEditorFixture();
  const resource = { id: "qa-1", repoName: "qa-repo", title: "QA" };
  state.selectedQaListId = resource.id;
  state.qaLists = [resource];
  Object.assign(state.qaListEditor, { qaListId: resource.id, repoName: resource.repoName });
  invokeHandler = async (command) => command === "list_local_gnosis_qa_list_metadata_records" ? [{
    ...resource, fullName: "actual-owner/qa-repo", githubRepoId: 43, defaultBranch: "qa",
  }] : { qaListId: resource.id, title: "QA", terms: [] };
  const payload = await createQaListEditorQueryOptions(state.teams[0], resource).queryFn();
  applyQaListEditorPayload(payload);
  assert.equal(state.qaListEditor.fullName, "actual-owner/qa-repo");
  assert.equal(state.qaListEditor.repoId, 43);
  assert.equal(state.qaListEditor.defaultBranchName, "qa");
});

test("a late metadata lookup cannot replace another glossary after navigation", async () => {
  installGlossaryEditorFixture();
  state.glossaries[0].fullName = "";
  const metadata = deferred();
  invokeHandler = async (command) => {
    if (command === "load_gtms_glossary_editor_data") return {
      glossaryId: "glossary-1", title: "Original", terms: [],
    };
    if (command === "list_local_gnosis_glossary_metadata_records") return metadata.promise;
    return null;
  };
  const opening = openGlossaryEditor(() => {}, "glossary-1");
  await flushAsyncWork();
  state.selectedGlossaryId = "other";
  state.glossaryEditor = {
    ...createGlossaryEditorState(), glossaryId: "other", repoName: "other",
    fullName: "owner/other", status: "ready",
  };
  metadata.resolve([{
    id: "glossary-1", repoName: "glossary-1", title: "Original",
    fullName: "owner/glossary-1", githubRepoId: 42,
  }]);
  await opening;
  assert.equal(state.glossaryEditor.glossaryId, "other");
  assert.equal(state.glossaryEditor.fullName, "owner/other");
  assert.equal(state.glossaryTermEditor.isOpen, false);
});

for (const context of ["missing summary", "missing full name"]) {
  for (const termId of [null, "term-1"]) {
    test(`${termId ? "editing" : "creating"} a glossary term syncs with ${context}`, async () => {
      installGlossaryEditorFixture();
      Object.assign(state.glossaryEditor, {
        fullName: "fixture-org/glossary-1",
        repoId: 42,
        defaultBranchName: "translation",
        defaultBranchHeadOid: "remote-head-1",
      });
      if (context === "missing summary") {
        state.glossaries = [];
      } else {
        state.glossaries[0].fullName = "";
        state.glossaries[0].defaultBranchName = "translation";
      }
      state.glossaryTermEditor = {
        ...createGlossaryTermEditorState(),
        isOpen: true,
        glossaryId: "glossary-1",
        termId,
        sourceTerms: ["Bons", "Bonz"],
        targetTerms: ["Bön"],
        footnote: "Keep this footnote.",
      };
      invokeHandler = async (command, payload) => {
        if (command === "sync_gtms_glossary_editor_repo") {
          if (!payload.input.repoName || !payload.input.fullName) {
            throw new Error("missing repository context");
          }
          return { changedTermIds: [], insertedTermIds: [], deletedTermIds: [] };
        }
        if (command === "upsert_gtms_glossary_term") {
          return { term: glossaryTerm({ ...payload.input, termId: termId || "created-term" }) };
        }
        if (command === "sync_gtms_glossary_repos") return [];
        return null;
      };

      await submitGlossaryTermEditor(() => {});
      await waitForGlossaryTermWrites();

      assert.equal(syncInvocationCount("upsert_gtms_glossary_term"), 1);
      const preflight = invokeLog.find(entry => entry.command === "sync_gtms_glossary_editor_repo").payload.input;
      assert.equal(preflight.installationId, 7);
      assert.equal(preflight.glossaryId, "glossary-1");
      assert.equal(preflight.repoName, "glossary-1");
      assert.equal(preflight.fullName, "fixture-org/glossary-1");
      assert.equal(preflight.repoId, 42);
      assert.equal(preflight.defaultBranchName, "translation");
      const pushedRepo = invokeLog.find(entry => entry.command === "sync_gtms_glossary_repos")?.payload.input.glossaries[0];
      assert.equal(pushedRepo?.fullName, preflight.fullName);
      assert.equal(pushedRepo?.repoName, preflight.repoName);
      assert.equal(state.glossaryTermEditor.isOpen, false);
      assert.equal(state.glossaryEditor.terms.find(term => term.termId === (termId || "created-term"))?.footnote, "Keep this footnote.");
    });
  }
}

test("missing glossary repository identity is not inferred from the team and preserves the draft", async () => {
  installGlossaryEditorFixture();
  state.glossaries[0].fullName = "";
  const draft = {
    ...createGlossaryTermEditorState(),
    isOpen: true,
    glossaryId: "glossary-1",
    sourceTerms: ["Bons"],
    targetTerms: ["Bön"],
    footnote: "Keep this footnote.",
  };
  state.glossaryTermEditor = draft;

  await submitGlossaryTermEditor(() => {});
  await waitForGlossaryTermWrites();

  assert.equal(state.glossaryTermEditor, draft);
  assert.match(draft.error, /repository/i);
  assert.equal(draft.footnote, "Keep this footnote.");
  assert.equal(syncInvocationCount("sync_gtms_glossary_editor_repo"), 0);
  assert.equal(syncInvocationCount("upsert_gtms_glossary_term"), 0);
});

for (const conflict of ["glossary ID", "repo name", "full name", "repo ID", "full name path"]) {
  test(`conflicting glossary ${conflict} preserves the draft without syncing`, async () => {
    installGlossaryEditorFixture();
    const summary = state.glossaries[0];
    state.glossaryEditor.fullName = summary.fullName;
    state.glossaryEditor.repoId = summary.repoId;
    if (conflict === "glossary ID") {
      summary.id = "other-glossary";
      state.selectedGlossaryId = summary.id;
    }
    if (conflict === "repo name") summary.repoName = "other-repo";
    if (conflict === "full name") summary.fullName = "other-org/glossary-1";
    if (conflict === "repo ID") summary.repoId = 999;
    if (conflict === "full name path") {
      summary.fullName = "fixture-org/other-repo";
      state.glossaryEditor.fullName = summary.fullName;
    }
    const draft = {
      ...createGlossaryTermEditorState(),
      isOpen: true,
      glossaryId: "glossary-1",
      sourceTerms: ["Bons"],
      targetTerms: ["Bön"],
      footnote: "Keep this footnote.",
    };
    state.glossaryTermEditor = draft;

    await submitGlossaryTermEditor(() => {});
    await waitForGlossaryTermWrites();

    assert.equal(state.glossaryTermEditor, draft);
    assert.match(draft.error, /repository details have changed/);
    assert.equal(draft.footnote, "Keep this footnote.");
    assert.equal(invokeLog.length, 0);
  });
}

test("saving a glossary term sanitizes ruby markup and escapes unsupported inline formatting", async () => {
  installGlossaryEditorFixture({
    terms: [
      glossaryTerm({
        termId: "term-1",
        sourceTerms: ["server source"],
        targetTerms: ["server target"],
      }),
    ],
  });
  state.glossaryTermEditor = {
    ...createGlossaryTermEditorState(),
    isOpen: true,
    glossaryId: "glossary-1",
    termId: "term-1",
    sourceTerms: ["<ruby>漢字<rt>かんじ</rt></ruby>", "<strong>bold</strong>"],
    targetTerms: ["<ruby>精神<rt>せいしん</rt></ruby>", "<em>mind</em>"],
    notesToTranslators: "",
    footnote: "",
    untranslated: false,
  };

  let capturedUpsertInput = null;
  invokeHandler = async (command, payload) => {
    switch (command) {
      case "ensure_local_team_metadata_repo":
        return null;
      case "lookup_local_team_metadata_tombstone":
        return false;
      case "sync_gtms_glossary_editor_repo":
        return {
          oldHeadSha: "head-1",
          newHeadSha: "head-1",
          changedTermIds: [],
          insertedTermIds: [],
          deletedTermIds: [],
        };
      case "upsert_gtms_glossary_term":
        capturedUpsertInput = cloneValue(payload?.input);
        return {
          glossaryId: "glossary-1",
          termCount: 1,
          term: {
            termId: "term-1",
            sourceTerms: capturedUpsertInput.sourceTerms,
            targetTerms: capturedUpsertInput.targetTerms,
            notesToTranslators: "",
            footnote: "",
            untranslated: false,
            lifecycleState: "active",
          },
        };
      case "sync_gtms_glossary_repos":
        return [];
      case "load_gtms_glossary_editor_data":
        return {
          glossaryId: "glossary-1",
          title: "Fixture Glossary",
          sourceLanguage: { code: "es", name: "Spanish" },
          targetLanguage: { code: "fr", name: "French" },
          lifecycleState: "active",
          termCount: 1,
          terms: [
            {
              termId: "term-1",
              sourceTerms: capturedUpsertInput?.sourceTerms ?? [],
              targetTerms: capturedUpsertInput?.targetTerms ?? [],
              notesToTranslators: "",
              footnote: "",
              untranslated: false,
              lifecycleState: "active",
            },
          ],
        };
      default:
        return null;
    }
  };

  await submitGlossaryTermEditor(() => {});
  await waitForGlossaryTermWrites();

  assert.deepEqual(capturedUpsertInput?.sourceTerms, [
    "<ruby>漢字<rt>かんじ</rt></ruby>",
    "&lt;strong&gt;bold&lt;/strong&gt;",
  ]);
  assert.deepEqual(capturedUpsertInput?.targetTerms, [
    "<ruby>精神<rt>せいしん</rt></ruby>",
    "&lt;em&gt;mind&lt;/em&gt;",
  ]);
  assert.deepEqual(state.glossaryEditor.terms[0]?.sourceTerms, capturedUpsertInput?.sourceTerms);
  assert.deepEqual(state.glossaryEditor.terms[0]?.targetTerms, capturedUpsertInput?.targetTerms);
});

for (const available of [true, false]) {
  test(`glossary background sync keeps sync paused and gates the update prompt on platform availability (${available})`, async () => {
    installGlossaryEditorFixture();

    state.appUpdate = createAppUpdateState();
    invokeHandler = async (command) => {
      if (command === "check_for_app_update") {
        return { available, version: available ? "0.1.36" : null, currentVersion: "0.1.35" };
      }
      if (command === "sync_gtms_glossary_editor_repo") {
        throw new Error(
          "APP_UPDATE_REQUIRED:{\"requiredVersion\":\"0.1.36\",\"currentVersion\":\"0.1.35\",\"message\":\"Update before syncing this glossary.\"}",
        );
      }
      return null;
    };

    startGlossaryBackgroundSyncSession(() => {});
    await flushAsyncWork();

    const synced = await maybeStartGlossaryBackgroundSync(() => {}, { force: true });

    assert.equal(synced, false);
    await new Promise(setImmediate);
    assert.equal(state.appUpdate.required, available);
    assert.equal(state.appUpdate.promptVisible, available);
    assert.equal(state.appUpdate.version, "0.1.36");
    assert.equal(state.appUpdate.currentVersion, "0.1.35");
    assert.equal(state.appUpdate.requirement.message, "Update before syncing this glossary.");
  });
}

test("completing an A save must not insert its term into B", async () => {
  installGlossaryEditorFixture();
  const save = deferred();
  invokeHandler = async (command, payload) => {
    if (command === "upsert_gtms_glossary_term") return save.promise;
    if (command === "sync_gtms_glossary_repos") return [];
    if (command === "load_gtms_glossary_editor_data") return {
      glossaryId: payload.input.glossaryId, repoName: payload.input.repoName,
      title: "B", terms: [glossaryTerm({ termId: "b-term", targetTerms: ["B only"] })], termCount: 1,
    };
    return null;
  };
  await openGlossaryTermEditor(() => {}, "term-1");
  state.glossaryTermEditor.targetTerms = ["saved A term"];
  await submitGlossaryTermEditor(() => {});
  await flushAsyncWork();
  state.glossaries.push({ ...state.glossaries[0], id: "glossary-b", repoName: "glossary-b", fullName: "fixture-org/glossary-b" });
  await openGlossaryEditor(() => {}, "glossary-b");
  save.resolve({ term: glossaryTerm({ targetTerms: ["saved A term"] }), termCount: 2 });
  await waitForGlossaryTermWrites();
  assert.equal(state.glossaryEditor.glossaryId, "glossary-b");
  assert.equal(state.glossaryEditor.terms.some(t => t.termId === "term-1"), false);
});

test("opening B during an A write must finish loading B", async () => {
  installGlossaryEditorFixture();
  const { requestGlossaryTermWriteIntent } = await import("./glossary-term-write-coordinator.js");
  const write = deferred();
  requestGlossaryTermWriteIntent({ key: "a", scope: "glossary-repo:7:glossary-1", glossaryId: "glossary-1", teamId: "team-1" }, { run: () => write.promise, clearOnSuccess: true });
  invokeHandler = async (command, payload) => {
    if (command === "load_gtms_glossary_editor_data") return { glossaryId: payload.input.glossaryId, terms: [glossaryTerm({termId: "b-term"})] };
    return null;
  };
  state.glossaries.push({ ...state.glossaries[0], id: "glossary-b", repoName: "glossary-b", fullName: "fixture-org/glossary-b" });
  await openGlossaryEditor(() => {}, "glossary-b");
  write.resolve();
  await waitForGlossaryTermWrites();
  assert.equal(state.glossaryEditor.status, "ready");
});

test("successful deletion must remove the visible term", async () => {
  installGlossaryEditorFixture();
  invokeHandler = async (command) => {
    if (command === "delete_gtms_glossary_term") return { termId: "term-1", termCount: 1 };
    if (command === "sync_gtms_glossary_repos") return [];
    if (command === "load_gtms_glossary_editor_data") return { glossaryId: "glossary-1", terms: [glossaryTerm({termId: "term-2"})], termCount: 1 };
    return null;
  };
  startGlossaryBackgroundSyncSession(() => {});
  await flushAsyncWork();
  await deleteGlossaryTerm(() => {}, "term-1");
  assert.equal(state.glossaryEditor.terms.some(t => t.termId === "term-1"), false);
});

test("deleting a search result without a collection summary updates the filtered screen", async () => {
  installGlossaryEditorFixture();
  state.glossaryEditor.fullName = state.glossaries[0].fullName;
  state.glossaryEditor.defaultBranchHeadOid = "remote-head-1";
  state.glossaryEditor.searchQuery = "uno";
  state.glossaries = [];
  let renderedHtml = "";
  const { renderGlossaryEditorScreen } = await import("../screens/glossary-editor.js");
  invokeHandler = async (command) => {
    if (command === "delete_gtms_glossary_term") return { termId: "term-1", termCount: 1 };
    if (command === "sync_gtms_glossary_repos") return [];
    return null;
  };

  await deleteGlossaryTerm(() => { renderedHtml = renderGlossaryEditorScreen(state); }, "term-1");

  assert.equal(syncInvocationCount("delete_gtms_glossary_term"), 1);
  assert.equal(syncInvocationCount("sync_gtms_glossary_repos"), 1);
  assert.deepEqual(state.glossaryEditor.terms.map(term => term.termId), ["term-2"]);
  assert.equal(state.glossaryEditor.searchQuery, "uno");
  assert.match(renderedHtml, /No terms match this search/);
  assert.doesNotMatch(renderedHtml, /edit-glossary-term:term-1/);
});

test("a rejected edit restores the saved row while keeping the conflicting draft", async () => {
  installGlossaryEditorFixture({ terms: [glossaryTerm({ sourceTerms: ["Original"] })] });
  state.glossaryEditor.searchQuery = "Dugpa";
  await openGlossaryTermEditor(() => {}, "term-1");
  state.glossaryTermEditor.sourceTerms = ["Dag Dugpa"];
  invokeHandler = async (command) => {
    if (command === "sync_gtms_glossary_editor_repo") return { changedTermIds: [] };
    if (command === "upsert_gtms_glossary_term") {
      state.glossaryEditor.terms.push(glossaryTerm({ termId: "remote-term", sourceTerms: ["Dag Dugpa"] }));
      throw new Error('Remove or change these duplicate source variants before saving: ["Dag Dugpa"]');
    }
    return null;
  };
  await submitGlossaryTermEditor(() => {});
  await waitForGlossaryTermWrites();

  assert.deepEqual(state.glossaryEditor.terms.find(term => term.termId === "term-1").sourceTerms, ["Original"]);
  assert.equal(state.glossaryEditor.terms.filter(term => term.sourceTerms.includes("Dag Dugpa")).length, 1);
  assert.deepEqual(state.glossaryTermEditor.sourceTerms, ["Dag Dugpa"]);
  assert.deepEqual(state.glossaryTermEditor.redundantSourceVariantIndices, [0]);
  assert.equal(state.glossaryEditor.searchQuery, "Dugpa");
});

for (const outcome of ["success", "failure", "rollback"]) {
  test(`glossary save ${outcome} after switching preserves B and recovers A`, async () => {
    installGlossaryEditorFixture();
    const originalPayload = cloneValue(state.glossaryEditor);
    const glossaryA = state.glossaries[0];
    const glossaryB = { ...glossaryA, id: "glossary-b", repoName: "glossary-b", fullName: "fixture-org/glossary-b" };
    state.glossaries.push(glossaryB);
    const save = deferred();
    let attempt = 0;
    invokeHandler = async (command, payload) => {
      if (command === "upsert_gtms_glossary_term") {
        attempt += 1;
        if (attempt === 1) return save.promise;
        assert.equal(payload.input.glossaryId, glossaryA.id);
        assert.equal(payload.input.repoName, glossaryA.repoName);
        return { term: glossaryTerm({ targetTerms: payload.input.targetTerms }), termCount: 2 };
      }
      if (command === "sync_gtms_glossary_repos") {
        if (outcome === "rollback" && attempt === 1) return [{ repoName: glossaryA.repoName, status: "syncError", message: "Push failed" }];
        return [];
      }
      if (command === "load_gtms_glossary_editor_data") {
        if (payload.input.glossaryId === glossaryA.id) return originalPayload;
        return { glossaryId: glossaryB.id, title: "B", terms: [glossaryTerm({ termId: "b-term" })], termCount: 1 };
      }
      return null;
    };
    await openGlossaryTermEditor(() => {}, "term-1");
    state.glossaryTermEditor.targetTerms = ["A draft"];
    await submitGlossaryTermEditor(() => {});
    await flushAsyncWork();
    await openGlossaryEditor(() => {}, glossaryB.id);
    assert.equal(state.glossaryEditor.status, "ready");
    const before = cloneValue(state.glossaryEditor);
    if (outcome === "failure") save.reject(new Error("Save failed"));
    else save.resolve({ term: glossaryTerm({ targetTerms: ["A draft"] }), termCount: 2, previousHeadSha: "old-A-head" });
    await waitForGlossaryTermWrites();
    assert.deepEqual(state.glossaryEditor, before);
    assert.equal(state.glossaryTermEditor.isOpen, false);
    if (outcome === "rollback") {
      const rollback = invokeLog.find(entry => entry.command === "rollback_gtms_glossary_term_upsert");
      assert.equal(rollback.payload.input.glossaryId, glossaryA.id);
    }
    if (outcome !== "success") {
      await openGlossaryEditor(() => {}, glossaryA.id);
      assert.equal(state.glossaryTermEditor.glossaryId, glossaryA.id);
      assert.deepEqual(state.glossaryTermEditor.targetTerms, ["A draft"]);
      await submitGlossaryTermEditor(() => {});
      await waitForGlossaryTermWrites();
      assert.equal(attempt, 2);
      assert.equal(state.glossaryTermEditor.isOpen, false);
      assert.deepEqual(state.glossaryEditor.terms[0].targetTerms, ["A draft"]);
    }
  });
}

test("cold return to a glossary resumes after its save finishes", async () => {
  installGlossaryEditorFixture();
  const originalPayload = cloneValue(state.glossaryEditor);
  state.glossaries.push({ ...state.glossaries[0], id: "glossary-b", repoName: "glossary-b", fullName: "fixture-org/glossary-b" });
  const save = deferred();
  invokeHandler = async (command, payload) => {
    if (command === "upsert_gtms_glossary_term") return save.promise;
    if (command === "sync_gtms_glossary_repos") return [];
    if (command === "load_gtms_glossary_editor_data") return { ...originalPayload, glossaryId: payload.input.glossaryId, repoName: payload.input.repoName };
    return null;
  };
  await openGlossaryTermEditor(() => {}, "term-1");
  state.glossaryTermEditor.targetTerms = ["saved"];
  await submitGlossaryTermEditor(() => {});
  await flushAsyncWork();
  await openGlossaryEditor(() => {}, "glossary-b");
  const opening = openGlossaryEditor(() => {}, "glossary-1");
  await flushAsyncWork();
  assert.equal(state.glossaryEditor.status, "loading");
  originalPayload.terms[0].targetTerms = ["saved"];
  save.resolve({ term: glossaryTerm({ targetTerms: ["saved"] }), termCount: 2 });
  await opening;
  assert.equal(state.glossaryEditor.status, "ready");
  assert.deepEqual(state.glossaryEditor.terms[0].targetTerms, ["saved"]);
});

test("confirmed glossary deletion preserves another open term draft", async () => {
  installGlossaryEditorFixture();
  await openGlossaryTermEditor(() => {}, "term-2");
  state.glossaryTermEditor.targetTerms = ["unsaved edit"];
  const draft = cloneValue(state.glossaryTermEditor);
  invokeHandler = async (command) => command === "sync_gtms_glossary_repos" ? [] : null;
  await deleteGlossaryTerm(() => {}, "term-1");
  assert.deepEqual(state.glossaryEditor.terms.map(term => term.termId), ["term-2"]);
  assert.deepEqual(state.glossaryTermEditor, draft);
});

test("queued glossary writes keep their original repository after navigation", async () => {
  installGlossaryEditorFixture();
  const save = deferred();
  let saves = 0;
  invokeHandler = async (command, payload) => {
    if (command === "upsert_gtms_glossary_term") {
      saves += 1;
      assert.equal(payload.input.repoName, "glossary-1");
      if (saves === 1) await save.promise;
      return { term: glossaryTerm({ termId: payload.input.termId, targetTerms: payload.input.targetTerms }), termCount: 2 };
    }
    if (command === "sync_gtms_glossary_repos") return [];
    if (command === "load_gtms_glossary_editor_data") return { glossaryId: payload.input.glossaryId, terms: [] };
    return null;
  };
  await openGlossaryTermEditor(() => {}, "term-1");
  await submitGlossaryTermEditor(() => {});
  await flushAsyncWork();
  await openGlossaryTermEditor(() => {}, "term-2");
  state.glossaryTermEditor.targetTerms = ["queued A edit"];
  await submitGlossaryTermEditor(() => {});
  state.glossaries.push({ ...state.glossaries[0], id: "glossary-b", repoName: "glossary-b", fullName: "fixture-org/glossary-b" });
  await openGlossaryEditor(() => {}, "glossary-b");
  const secondPreflightStart = invokeLog.length;
  save.resolve();
  await waitForGlossaryTermWrites();
  assert.equal(saves, 2);
  const preflights = invokeLog.slice(secondPreflightStart).filter(entry => entry.command === "sync_gtms_glossary_editor_repo");
  assert.equal(preflights.length, 1);
  assert.equal(preflights[0].payload.input.repoName, "glossary-1");
  assert.deepEqual(state.glossaryEditor.terms, []);
});

test("a saved glossary term does not patch a different team with matching resource IDs", async () => {
  installGlossaryEditorFixture();
  const save = deferred();
  invokeHandler = async (command) => {
    if (command === "upsert_gtms_glossary_term") return save.promise;
    if (command === "sync_gtms_glossary_repos") return [];
    return null;
  };
  await openGlossaryTermEditor(() => {}, "term-1");
  await submitGlossaryTermEditor(() => {});
  await flushAsyncWork();
  state.selectedTeamId = "other-team";
  state.teams.push({ ...state.teams[0], id: "other-team", installationId: 99 });
  state.glossaryEditor.terms = [glossaryTerm({ targetTerms: ["other team's term"] })];
  const before = cloneValue(state.glossaryEditor);
  save.resolve({ term: glossaryTerm({ targetTerms: ["A's term"] }), termCount: 2 });
  await waitForGlossaryTermWrites();
  assert.deepEqual(state.glossaryEditor, before);
});

test("dismissing a recovered glossary draft clears its failure without reopening it", async () => {
  installGlossaryEditorFixture();
  const { cancelGlossaryTermEditor } = await import("./glossary-term-draft.js");
  const originalPayload = cloneValue(state.glossaryEditor);
  invokeHandler = async (command) => {
    if (command === "upsert_gtms_glossary_term") throw new Error("Save failed");
    if (command === "load_gtms_glossary_editor_data") return originalPayload;
    return null;
  };
  await openGlossaryTermEditor(() => {}, "term-1");
  state.glossaryTermEditor.targetTerms = ["unsaved"];
  await submitGlossaryTermEditor(() => {});
  await waitForGlossaryTermWrites();
  assert.equal(state.glossaryTermEditor.isOpen, true);
  cancelGlossaryTermEditor(() => {});
  assert.deepEqual(state.glossaryEditor.terms[0].targetTerms, originalPayload.terms[0].targetTerms);
  assert.equal(state.glossaryEditor.terms[0].pendingError, "");
  await openGlossaryEditor(() => {}, "glossary-1");
  assert.equal(state.glossaryTermEditor.isOpen, false);
});

for (const outcome of ["success", "rollback"]) {
  for (const returnBeforeLocalSave of [true, false]) {
    test(`translation editor uses local terms during push (${outcome}, early return: ${returnBeforeLocalSave})`, async () => {
      const { loadEditorGlossaryState } = await import("./editor-glossary-flow.js");
      installGlossaryEditorFixture();
      const team = state.teams[0];
      const link = { glossaryId: "glossary-1", repoName: "glossary-1" };
      const chapter = { id: "chapter-1", linkedGlossary: link };
      state.projects = [{ id: "project-1", chapters: [chapter] }];
      state.selectedChapterId = chapter.id;
      const original = cloneValue(state.glossaryEditor);
      let disk = original;
      const save = deferred();
      const push = deferred();
      let pushing = false;
      invokeHandler = async (command, payload) => {
        if (command === "load_gtms_glossary_editor_data") return cloneValue(disk);
        if (command === "sync_gtms_glossary_editor_repo") return { changedTermIds: [] };
        if (command === "upsert_gtms_glossary_term") {
          await save.promise;
          const term = glossaryTerm({ targetTerms: payload.input.targetTerms });
          disk = { ...original, terms: [term, original.terms[1]] };
          return { term, termCount: 2, previousHeadSha: "old-head" };
        }
        if (command === "sync_gtms_glossary_repos") {
          pushing = true;
          await push.promise;
          if (outcome === "rollback") return [{ status: "syncError", message: "Push failed" }];
          // A successful sync can also bring another translator's term back.
          disk = { ...disk, terms: [...disk.terms, glossaryTerm({ termId: "remote-term" })] };
          return [];
        }
        if (command === "rollback_gtms_glossary_term_upsert") disk = original;
        return null;
      };
      state.editorChapter = {
        ...state.editorChapter, status: "ready", chapterId: chapter.id,
        glossary: await loadEditorGlossaryState(team, chapter),
      };
      const originalMatcher = state.editorChapter.glossary.matcherModel;
      const rows = state.editorChapter.rows;
      const fieldEditor = state.editorChapter.mainFieldEditor;
      const renderCalls = [];
      const render = (options) => renderCalls.push(options);
      await openGlossaryTermEditor(render, "term-1");
      state.glossaryTermEditor.targetTerms = ["New local translation"];
      await submitGlossaryTermEditor(render);
      if (returnBeforeLocalSave) state.screen = "translate";
      save.resolve();
      await flushAsyncWork();
      assert.equal(pushing, true);
      if (!returnBeforeLocalSave) {
        state.screen = "translate";
        state.editorChapter.glossary = await loadEditorGlossaryState(team, chapter);
      }
      assert.deepEqual(state.editorChapter.glossary.terms[0].targetTerms, ["New local translation"]);
      assert.notEqual(state.editorChapter.glossary.matcherModel, originalMatcher);
      assert.equal(state.editorChapter.rows, rows);
      assert.equal(state.editorChapter.mainFieldEditor, fieldEditor);
      assert.equal(renderCalls.some(options => options?.scope === "translate-body"), false);

      push.resolve();
      await waitForGlossaryTermWrites();
      await flushAsyncWork();
      assert.deepEqual(state.editorChapter.glossary.terms[0].targetTerms,
        outcome === "rollback" ? original.terms[0].targetTerms : ["New local translation"]);
      assert.equal(state.editorChapter.glossary.terms.length, outcome === "success" ? 3 : 2);
      assert.equal(state.editorChapter.rows, rows);
      assert.equal(state.editorChapter.mainFieldEditor, fieldEditor);
    });
  }
}

for (const destination of ["team", "chapter", "link", "screen"]) {
  test(`local glossary refresh ignores a late result after changing ${destination}`, async () => {
    const { refreshEditorGlossaryAfterLocalChange } = await import("./editor-glossary-flow.js");
    installGlossaryEditorFixture();
    const team = state.teams[0];
    const link = { glossaryId: "glossary-1", repoName: "glossary-1" };
    const chapter = { id: "chapter-1", linkedGlossary: link };
    state.projects = [{ id: "project-1", chapters: [chapter] }];
    state.screen = "translate";
    state.editorChapter = { ...state.editorChapter, status: "ready", chapterId: chapter.id, glossary: link };
    const read = deferred();
    invokeHandler = async () => read.promise;
    const refresh = refreshEditorGlossaryAfterLocalChange(() => assert.fail("Unexpected render"), team, link);
    await flushAsyncWork();
    if (destination === "team") state.selectedTeamId = "other-team";
    if (destination === "chapter") state.editorChapter.chapterId = "other-chapter";
    if (destination === "link") chapter.linkedGlossary = { ...link, glossaryId: "other-glossary" };
    if (destination === "screen") state.screen = "glossaryEditor";
    read.resolve(cloneValue(state.glossaryEditor));
    await refresh;
    assert.equal(state.editorChapter.glossary, link);
  });
}

test("an in-flight glossary read cannot overwrite the rollback snapshot", async () => {
  const { refreshEditorGlossaryAfterLocalChange } = await import("./editor-glossary-flow.js");
  installGlossaryEditorFixture();
  const team = state.teams[0];
  const link = { glossaryId: "glossary-1", repoName: "glossary-1" };
  const chapter = { id: "chapter-1", linkedGlossary: link };
  state.projects = [{ id: "project-1", chapters: [chapter] }];
  state.screen = "translate";
  state.editorChapter = { ...state.editorChapter, status: "ready", chapterId: chapter.id, glossary: link };
  const read = deferred();
  const restored = cloneValue(state.glossaryEditor);
  let reads = 0;
  invokeHandler = async () => ++reads === 1 ? read.promise : restored;
  const older = refreshEditorGlossaryAfterLocalChange(() => {}, team, link);
  await flushAsyncWork();
  await refreshEditorGlossaryAfterLocalChange(() => {}, team, link);
  read.resolve({ ...restored, terms: [glossaryTerm({ targetTerms: ["Rolled back"] })] });
  await older;
  assert.deepEqual(state.editorChapter.glossary.terms, restored.terms);
});

test("a locally deleted term disappears before push and returns after rollback", async () => {
  const { loadEditorGlossaryState } = await import("./editor-glossary-flow.js");
  installGlossaryEditorFixture();
  const team = state.teams[0];
  const link = { glossaryId: "glossary-1", repoName: "glossary-1" };
  const chapter = { id: "chapter-1", linkedGlossary: link };
  state.projects = [{ id: "project-1", chapters: [chapter] }];
  const original = cloneValue(state.glossaryEditor);
  let disk = original;
  const push = deferred();
  invokeHandler = async (command) => {
    if (command === "load_gtms_glossary_editor_data") return cloneValue(disk);
    if (command === "delete_gtms_glossary_term") {
      disk = { ...original, terms: original.terms.filter(term => term.termId !== "term-1") };
      state.screen = "translate";
      return { previousHeadSha: "old-head" };
    }
    if (command === "sync_gtms_glossary_repos") {
      await push.promise;
      return [{ status: "syncError", message: "Push failed" }];
    }
    if (command === "rollback_gtms_glossary_term_upsert") disk = original;
    return null;
  };
  state.editorChapter = {
    ...state.editorChapter, status: "ready", chapterId: chapter.id,
    glossary: await loadEditorGlossaryState(team, chapter),
  };
  const deleting = deleteGlossaryTerm(() => {}, "term-1");
  await flushAsyncWork();
  assert.deepEqual(state.editorChapter.glossary.terms.map(term => term.termId), ["term-2"]);
  push.resolve();
  await deleting;
  await flushAsyncWork();
  assert.deepEqual(state.editorChapter.glossary.terms, original.terms);
});

function installLinkedEditorFixture() {
  installGlossaryEditorFixture();
  const team = state.teams[0];
  const link = { glossaryId: "glossary-1", repoName: "glossary-1" };
  const chapter = { id: "chapter-1", linkedGlossary: link };
  const project = { id: "project-1", name: "project-1", chapters: [chapter] };
  state.projects = [project];
  state.screen = "translate";
  state.selectedChapterId = chapter.id;
  state.editorChapter = {
    ...state.editorChapter, status: "ready", chapterId: chapter.id,
    glossary: { ...link, status: "ready" }, rows: [{ rowId: "row-1" }],
  };
  return { team, link, chapter, project };
}

for (const failureFirst of [true, false]) {
  test(`newer glossary refresh survives obsolete read failure (failure first: ${failureFirst})`, async () => {
    const { refreshEditorGlossaryAfterLocalChange } = await import("./editor-glossary-flow.js");
    const { team, link } = installLinkedEditorFixture();
    const oldRead = deferred();
    const newRead = deferred();
    const restored = cloneValue(state.glossaryEditor);
    let calls = 0;
    invokeHandler = async () => ++calls === 1 ? oldRead.promise : newRead.promise;
    const older = refreshEditorGlossaryAfterLocalChange(() => {}, team, link);
    await flushAsyncWork();
    const newer = refreshEditorGlossaryAfterLocalChange(() => {}, team, link);
    await flushAsyncWork();
    if (failureFirst) {
      oldRead.reject(new Error("Could not read glossary term during checkout"));
      await flushAsyncWork();
    }
    newRead.resolve(restored);
    await newer;
    if (!failureFirst) oldRead.reject(new Error("Could not read glossary term during checkout"));
    await older;
    assert.equal(state.editorChapter.glossary.status, "ready");
    assert.deepEqual(state.editorChapter.glossary.terms, restored.terms);
  });
}

for (const outcome of ["save", "rollback"]) {
  test(`pending-write chapter resume reloads an off-screen glossary ${outcome} without replacing editor state`, async () => {
    const { refreshEditorGlossaryAfterLocalChange, loadEditorGlossaryState } = await import("./editor-glossary-flow.js");
    const { openTranslateChapter } = await import("./editor-chapter-load-flow.js");
    const { requestEditorOperation, resetEditorOperationQueue } = await import("./editor-operation-queue.js");
    const { projectRepoScope } = await import("./repo-write-queue.js");
    const { team, link, chapter, project } = installLinkedEditorFixture();
    const original = cloneValue(state.glossaryEditor);
    const changed = { ...original, terms: [glossaryTerm({ targetTerms: ["New local value"] })] };
    let disk = outcome === "save" ? original : changed;
    const resumedRead = deferred();
    let delayRead = false;
    invokeHandler = async (command) => {
      if (command === "load_gtms_glossary_editor_data") return delayRead ? resumedRead.promise : disk;
      return null;
    };
    state.editorChapter.glossary = await loadEditorGlossaryState(team, chapter);
    state.editorChapter.dirtyRowIds = new Set(["row-1"]);
    const rows = state.editorChapter.rows;
    const dirtyRows = state.editorChapter.dirtyRowIds;
    const fieldEditor = state.editorChapter.mainFieldEditor;
    const pending = deferred();
    const operation = requestEditorOperation({
      repoScope: projectRepoScope({ team, project }), metadata: { chapterId: chapter.id },
    }, { run: () => pending.promise });
    try {
      state.screen = "glossaryEditor";
      disk = outcome === "save" ? changed : original;
      await refreshEditorGlossaryAfterLocalChange(() => {}, team, link);
      delayRead = true;
      const opened = await openTranslateChapter(() => {}, chapter.id, {
        applyEditorUiState() {}, normalizeEditorRows: value => value,
        applyChapterMetadataToState() {}, loadActiveEditorFieldHistory() {},
        flushDirtyEditorRows: async () => true, persistEditorChapterSelections() {},
      });
      // Opening must finish even while the glossary read and chapter save wait.
      assert.equal(opened, true);
      resumedRead.resolve(disk);
      await flushAsyncWork();
      assert.deepEqual(state.editorChapter.glossary.terms, disk.terms);
      assert.equal(state.editorChapter.rows, rows);
      assert.equal(state.editorChapter.dirtyRowIds, dirtyRows);
      assert.equal(state.editorChapter.mainFieldEditor, fieldEditor);
      assert.equal(syncInvocationCount("load_gtms_chapter_editor_data"), 0);
    } finally {
      resumedRead.resolve(disk);
      pending.resolve();
      await operation.promise;
      resetEditorOperationQueue();
    }
  });
}
