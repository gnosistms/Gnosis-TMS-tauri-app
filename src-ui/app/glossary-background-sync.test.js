import test from "node:test";
import assert from "node:assert/strict";

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
globalThis.navigator = globalThis.window.navigator;

const {
  createGlossaryEditorState,
  createGlossaryTermEditorState,
  resetSessionState,
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
} = await import("./glossary-term-draft.js");
const {
  anyGlossaryTermWriteIsActive,
  resetGlossaryTermWriteCoordinator,
} = await import("./glossary-term-write-coordinator.js");

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

test.beforeEach(async () => {
  invokeLog.length = 0;
  scheduledIntervals.clear();
  scheduledTimeouts.clear();
  localStorageState.clear();
  currentTime = 0;
  nextTimerId = 1;
  invokeHandler = async () => null;
  resetSessionState();
  resetGlossaryTermWriteCoordinator();
  await syncAndStopGlossaryBackgroundSyncSession(() => {});
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
    notesToTranslators: "local note",
    footnote: "local footnote",
    untranslated: false,
  });
  assert.equal(state.glossaryTermEditor.isOpen, false);
  assert.deepEqual(state.glossaryEditor.terms[0]?.targetTerms, ["local target overwrite"]);
  assert.ok(renderCalls.length > 0);
});

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

test("glossary background sync opens a required update prompt when the repo was saved by a newer app", async () => {
  installGlossaryEditorFixture();

  invokeHandler = async (command) => {
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
  assert.equal(state.appUpdate.required, true);
  assert.equal(state.appUpdate.promptVisible, true);
  assert.equal(state.appUpdate.version, "0.1.36");
  assert.equal(state.appUpdate.currentVersion, "0.1.35");
  assert.equal(state.appUpdate.message, "Update before syncing this glossary.");
});
