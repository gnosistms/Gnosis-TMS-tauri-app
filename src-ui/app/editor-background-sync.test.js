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
const invokeLog = [];
let invokeHandler = async () => null;
let nextTimerId = 1;
const scheduledIntervals = new Map();
const scheduledIntervalDelays = new Map();

const fakeApp = {
  addEventListener() {},
  firstElementChild: null,
  innerHTML: "",
};

const fakeDocument = {
  querySelector(selector) {
    return selector === "#app" ? fakeApp : null;
  },
  querySelectorAll() {
    return [];
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
};

globalThis.document = fakeDocument;
globalThis.performance = {
  now() {
    return 0;
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
  setInterval(callback, delay = 0) {
    const id = nextTimerId;
    nextTimerId += 1;
    scheduledIntervals.set(id, callback);
    scheduledIntervalDelays.set(id, delay);
    return id;
  },
  clearInterval(id) {
    scheduledIntervals.delete(id);
    scheduledIntervalDelays.delete(id);
  },
  setTimeout(callback) {
    callback();
    return 1;
  },
  clearTimeout() {},
  requestAnimationFrame(callback) {
    callback();
    return 1;
  },
  open() {},
};
globalThis.navigator = globalThis.window.navigator;

const {
  createEditorChapterState,
  resetSessionState,
  state,
} = await import("./state.js");
const {
  startEditorBackgroundSyncSession,
  syncAndStopEditorBackgroundSyncSession,
  syncEditorBackgroundNow,
  syncEditorBackgroundNowWithSummary,
} = await import("./editor-background-sync.js");

function deferred() {
  let resolve = null;
  let reject = null;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function createRenderRecorder() {
  const calls = [];
  const render = (options = undefined) => {
    calls.push(cloneValue(options));
  };
  render.calls = calls;
  return render;
}

function createEditorRowFixture(overrides = {}) {
  const fieldStates = {
    es: { reviewed: false, pleaseCheck: false },
    en: { reviewed: false, pleaseCheck: false },
  };
  return {
    rowId: "row-1",
    orderKey: "00001",
    lifecycleState: "active",
    freshness: "fresh",
    remotelyDeleted: false,
    commentCount: 0,
    commentsRevision: 0,
    saveStatus: "idle",
    saveError: "",
    textStyle: "paragraph",
    textStyleSaveState: { status: "idle", error: "" },
    markerSaveState: { status: "idle", error: "", languageCode: null, kind: null },
    fields: { es: "hola", en: "hello" },
    footnotes: { es: "", en: "" },
    imageCaptions: { es: "", en: "" },
    images: { es: null, en: null },
    persistedFields: { es: "hola", en: "hello" },
    persistedFootnotes: { es: "", en: "" },
    persistedImageCaptions: { es: "", en: "" },
    persistedImages: { es: null, en: null },
    fieldStates: cloneValue(fieldStates),
    persistedFieldStates: cloneValue(fieldStates),
    conflictState: null,
    ...overrides,
  };
}

function createRemoteRowPayload(rowId, overrides = {}) {
  return {
    rowId,
    orderKey: "00001",
    lifecycleState: "active",
    commentCount: 0,
    commentsRevision: 0,
    textStyle: "paragraph",
    fields: { es: "hola remoto", en: "hello remote" },
    footnotes: { es: "", en: "" },
    imageCaptions: { es: "", en: "" },
    images: { es: null, en: null },
    fieldStates: {
      es: { reviewed: false, pleaseCheck: false },
      en: { reviewed: false, pleaseCheck: false },
    },
    ...overrides,
  };
}

function installEditorFixture() {
  resetSessionState();
  state.auth.session = {
    sessionToken: "session-token",
    login: "fixture-user",
  };
  state.selectedTeamId = "team-1";
  state.teams = [{
    id: "team-1",
    githubOrg: "fixture-org",
    installationId: 7,
    canManageProjects: true,
    accountType: "organization",
  }];
  state.projects = [{
    id: "project-1",
    name: "fixture-project",
    fullName: "fixture-org/fixture-project",
    repoId: 42,
    defaultBranchName: "main",
    defaultBranchHeadOid: "head-1",
    chapters: [{
      id: "chapter-1",
      name: "Chapter 1",
      languages: [{ code: "es", name: "Spanish" }, { code: "en", name: "English" }],
    }],
  }];
  state.selectedProjectId = "project-1";
  state.selectedChapterId = "chapter-1";
  state.screen = "translate";
  state.editorChapter = {
    ...createEditorChapterState(),
    status: "ready",
    projectId: "project-1",
    chapterId: "chapter-1",
    chapterBaseCommitSha: "head-1",
    languages: [{ code: "es", name: "Spanish" }, { code: "en", name: "English" }],
    rows: [],
  };
}

test.afterEach(async () => {
  invokeHandler = async () => null;
  invokeLog.length = 0;
  localStorageState.clear();
  scheduledIntervals.clear();
  scheduledIntervalDelays.clear();
  await syncAndStopEditorBackgroundSyncSession(() => {});
  resetSessionState();
});

test("syncEditorBackgroundNow reruns after an older in-flight sync when a new local commit needs confirmation", async () => {
  installEditorFixture();

  const firstSync = deferred();
  const secondSync = deferred();
  let syncCallCount = 0;

  invokeHandler = async (command) => {
    if (command === "sync_gtms_project_editor_repo") {
      syncCallCount += 1;
      if (syncCallCount === 1) {
        return firstSync.promise;
      }
      if (syncCallCount === 2) {
        return secondSync.promise;
      }
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  startEditorBackgroundSyncSession(() => {});
  await Promise.resolve();
  const initialSyncPromise = syncEditorBackgroundNow(() => {}, { skipDirtyFlush: true });
  assert.equal(syncCallCount, 1);

  let resolved = false;
  const afterCommitSyncPromise = syncEditorBackgroundNow(() => {}, {
    skipDirtyFlush: true,
    afterLocalCommit: true,
  }).then((value) => {
    resolved = true;
    return value;
  });

  await Promise.resolve();
  assert.equal(syncCallCount, 1);
  assert.equal(resolved, false);

  firstSync.resolve({ changedRowIds: [], deletedRowIds: [], insertedRowIds: [], newHeadSha: "head-2" });
  await initialSyncPromise;
  await Promise.resolve();

  assert.equal(syncCallCount, 2);
  assert.equal(resolved, false);

  secondSync.resolve({ changedRowIds: [], deletedRowIds: [], insertedRowIds: [], newHeadSha: "head-3" });
  const syncPayload = await afterCommitSyncPromise;

  assert.equal(syncPayload.newHeadSha, "head-3");
  assert.deepEqual(
    invokeLog
      .filter((entry) => entry.command === "sync_gtms_project_editor_repo")
      .map((entry) => entry.payload.sessionToken),
    ["session-token", "session-token"],
  );
});

test("background sync does not rerender the editor body when sync starts or finishes without visible changes", async () => {
  installEditorFixture();
  state.editorChapter.rows = [createEditorRowFixture()];

  const syncRequest = deferred();
  invokeHandler = async (command) => {
    if (command === "sync_gtms_project_editor_repo") {
      return syncRequest.promise;
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  const render = createRenderRecorder();
  startEditorBackgroundSyncSession(render);
  await Promise.resolve();

  assert.deepEqual(render.calls, []);

  const pendingSync = syncEditorBackgroundNow(render, { skipDirtyFlush: true });
  syncRequest.resolve({
    changedRowIds: [],
    deletedRowIds: [],
    insertedRowIds: [],
    newHeadSha: "head-2",
  });
  await pendingSync;

  assert.deepEqual(render.calls, []);
  assert.equal(state.editorChapter.chapterBaseCommitSha, "head-2");
});

test("editor background sync session uses a three-minute remote sync interval", async () => {
  installEditorFixture();

  startEditorBackgroundSyncSession(() => {});
  await Promise.resolve();

  assert.equal(scheduledIntervalDelays.size, 1);
  assert.deepEqual([...scheduledIntervalDelays.values()], [180_000]);
});

test("background sync auto-refreshes a safe changed row through the visible-row patch path", async () => {
  installEditorFixture();
  state.editorChapter.rows = [createEditorRowFixture()];

  const syncRequest = deferred();
  invokeHandler = async (command) => {
    if (command === "sync_gtms_project_editor_repo") {
      return syncRequest.promise;
    }
    if (command === "load_gtms_editor_row") {
      return {
        chapterBaseCommitSha: "head-2",
        row: createRemoteRowPayload("row-1", {
          fields: { es: "hola remoto", en: "hello remote updated" },
        }),
      };
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  const render = createRenderRecorder();
  startEditorBackgroundSyncSession(render);
  await Promise.resolve();

  const pendingSync = syncEditorBackgroundNow(render, { skipDirtyFlush: true });
  syncRequest.resolve({
    changedRowIds: ["row-1"],
    deletedRowIds: [],
    insertedRowIds: [],
    newHeadSha: "head-2",
  });
  await pendingSync;

  assert.deepEqual(render.calls, [{
    scope: "translate-visible-rows",
    rowIds: ["row-1"],
    reason: "row-reload",
  }]);
  assert.equal(state.editorChapter.rows[0]?.freshness, "fresh");
  assert.equal(state.editorChapter.rows[0]?.fields?.en, "hello remote updated");
  assert.deepEqual(
    invokeLog
      .filter((entry) => entry.command === "load_gtms_editor_row")
      .map((entry) => entry.payload.input?.rowId),
    ["row-1"],
  );
});

test("background sync summary keeps safe visible row updates off the full-refresh path", async () => {
  installEditorFixture();
  state.editorChapter.rows = [createEditorRowFixture()];

  const syncRequest = deferred();
  invokeHandler = async (command) => {
    if (command === "sync_gtms_project_editor_repo") {
      return syncRequest.promise;
    }
    if (command === "load_gtms_editor_row") {
      return {
        chapterBaseCommitSha: "head-2",
        row: createRemoteRowPayload("row-1"),
      };
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  const render = createRenderRecorder();
  startEditorBackgroundSyncSession(render);
  await Promise.resolve();

  const pendingSync = syncEditorBackgroundNowWithSummary(render, {
    skipDirtyFlush: true,
    suppressConservativeRerender: true,
  });
  syncRequest.resolve({
    changedRowIds: ["row-1"],
    deletedRowIds: [],
    insertedRowIds: [],
    newHeadSha: "head-2",
  });
  const syncResult = await pendingSync;

  assert.equal(syncResult.requiresChapterReload, false);
  assert.deepEqual(syncResult.refreshedRowIds, ["row-1"]);
});

test("background sync summary flags deferred row changes for a full chapter reload", async () => {
  installEditorFixture();
  state.editorChapter.rows = [createEditorRowFixture({
    freshness: "conflict",
    saveStatus: "conflict",
  })];

  const syncRequest = deferred();
  invokeHandler = async (command) => {
    if (command === "sync_gtms_project_editor_repo") {
      return syncRequest.promise;
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  const render = createRenderRecorder();
  startEditorBackgroundSyncSession(render);
  await Promise.resolve();

  const pendingSync = syncEditorBackgroundNowWithSummary(render, {
    skipDirtyFlush: true,
    suppressConservativeRerender: true,
  });
  syncRequest.resolve({
    changedRowIds: ["row-1"],
    deletedRowIds: [],
    insertedRowIds: [],
    newHeadSha: "head-2",
  });
  const syncResult = await pendingSync;

  assert.equal(syncResult.requiresChapterReload, true);
  assert.deepEqual(syncResult.refreshedRowIds, []);
});

test("background sync keeps conflicting rows on the conservative path", async () => {
  installEditorFixture();
  state.editorChapter.rows = [createEditorRowFixture({
    freshness: "conflict",
    saveStatus: "conflict",
  })];

  const syncRequest = deferred();
  invokeHandler = async (command) => {
    if (command === "sync_gtms_project_editor_repo") {
      return syncRequest.promise;
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  const render = createRenderRecorder();
  startEditorBackgroundSyncSession(render);
  await Promise.resolve();

  const pendingSync = syncEditorBackgroundNow(render, { skipDirtyFlush: true });
  syncRequest.resolve({
    changedRowIds: ["row-1"],
    deletedRowIds: ["row-1"],
    insertedRowIds: [],
    newHeadSha: "head-2",
  });
  await pendingSync;

  assert.deepEqual(render.calls, [{ scope: "translate-body" }]);
  assert.equal(state.editorChapter.rows[0]?.freshness, "conflict");
  assert.equal(state.editorChapter.rows[0]?.remotelyDeleted, true);
  assert.deepEqual(
    invokeLog.filter((entry) => entry.command === "load_gtms_editor_row"),
    [],
  );
});

test("background sync keeps the active row on the conservative stale path", async () => {
  installEditorFixture();
  state.editorChapter.rows = [createEditorRowFixture()];
  state.editorChapter = {
    ...state.editorChapter,
    activeRowId: "row-1",
    activeLanguageCode: "en",
    mainFieldEditor: {
      rowId: "row-1",
      languageCode: "en",
    },
  };

  const syncRequest = deferred();
  invokeHandler = async (command) => {
    if (command === "sync_gtms_project_editor_repo") {
      return syncRequest.promise;
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  const render = createRenderRecorder();
  startEditorBackgroundSyncSession(render);
  await Promise.resolve();

  const pendingSync = syncEditorBackgroundNow(render, { skipDirtyFlush: true });
  syncRequest.resolve({
    changedRowIds: ["row-1"],
    deletedRowIds: [],
    insertedRowIds: [],
    newHeadSha: "head-2",
  });
  await pendingSync;

  assert.deepEqual(render.calls, [{ scope: "translate-body" }]);
  assert.equal(state.editorChapter.rows[0]?.freshness, "stale");
  assert.deepEqual(
    invokeLog.filter((entry) => entry.command === "load_gtms_editor_row"),
    [],
  );
});

test("background sync keeps structural changes on the conservative path", async () => {
  installEditorFixture();
  state.editorChapter.rows = [createEditorRowFixture()];

  const syncRequest = deferred();
  invokeHandler = async (command) => {
    if (command === "sync_gtms_project_editor_repo") {
      return syncRequest.promise;
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  const render = createRenderRecorder();
  startEditorBackgroundSyncSession(render);
  await Promise.resolve();

  const pendingSync = syncEditorBackgroundNow(render, { skipDirtyFlush: true });
  syncRequest.resolve({
    changedRowIds: ["row-1"],
    deletedRowIds: [],
    insertedRowIds: ["row-2"],
    newHeadSha: "head-2",
  });
  await pendingSync;

  assert.deepEqual(render.calls, [{ scope: "translate-body" }]);
  assert.equal(state.editorChapter.rows[0]?.freshness, "stale");
  assert.equal(state.editorChapter.deferredStructuralChanges, true);
  assert.deepEqual(
    invokeLog.filter((entry) => entry.command === "load_gtms_editor_row"),
    [],
  );
});

test("background sync ignores stale row updates from an obsolete sync base", async () => {
  installEditorFixture();
  state.editorChapter.rows = [createEditorRowFixture()];

  const syncRequest = deferred();
  invokeHandler = async (command) => {
    if (command === "sync_gtms_project_editor_repo") {
      return syncRequest.promise;
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  const render = createRenderRecorder();
  startEditorBackgroundSyncSession(render);
  await Promise.resolve();

  state.editorChapter = {
    ...state.editorChapter,
    chapterBaseCommitSha: "head-2",
  };

  const pendingSync = syncEditorBackgroundNow(render, { skipDirtyFlush: true });
  syncRequest.resolve({
    oldHeadSha: "head-1",
    changedRowIds: ["row-1"],
    deletedRowIds: [],
    insertedRowIds: [],
    newHeadSha: "head-2",
  });
  await pendingSync;

  assert.deepEqual(render.calls, []);
  assert.equal(state.editorChapter.rows[0]?.freshness, "fresh");
  assert.equal(state.editorChapter.chapterBaseCommitSha, "head-2");
  assert.deepEqual(
    invokeLog.filter((entry) => entry.command === "load_gtms_editor_row"),
    [],
  );
});

test("background sync skips skipDirtyFlush requests while row writes are still pending", async () => {
  installEditorFixture();
  const render = createRenderRecorder();
  startEditorBackgroundSyncSession(render);
  await Promise.resolve();
  invokeLog.length = 0;

  state.editorChapter.rows = [{
    rowId: "row-1",
    freshness: "fresh",
    remotelyDeleted: false,
    saveStatus: "idle",
    saveError: "",
    textStyle: "heading1",
    textStyleSaveState: { status: "saving", error: "" },
    markerSaveState: { status: "idle", error: "", languageCode: null, kind: null },
    fields: { es: "hola", en: "hello" },
    persistedFields: { es: "hola", en: "hello" },
    fieldStates: { es: { reviewed: false, pleaseCheck: false }, en: { reviewed: false, pleaseCheck: false } },
    persistedFieldStates: { es: { reviewed: false, pleaseCheck: false }, en: { reviewed: false, pleaseCheck: false } },
  }];

  invokeHandler = async (command) => {
    throw new Error(`Unexpected command: ${command}`);
  };

  const payload = await syncEditorBackgroundNow(render, { skipDirtyFlush: true });

  assert.equal(payload, null);
  assert.deepEqual(
    invokeLog.filter((entry) => entry.command === "sync_gtms_project_editor_repo"),
    [],
  );
});

test("background sync opens a required update prompt when the repo was saved by a newer app", async () => {
  installEditorFixture();

  invokeHandler = async (command) => {
    if (command === "sync_gtms_project_editor_repo") {
      throw new Error(
        "APP_UPDATE_REQUIRED:{\"requiredVersion\":\"0.1.36\",\"currentVersion\":\"0.1.35\",\"message\":\"Update before syncing this project.\"}",
      );
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  startEditorBackgroundSyncSession(() => {});
  await Promise.resolve();

  await syncEditorBackgroundNow(() => {}, { skipDirtyFlush: true });

  assert.equal(state.editorChapter.backgroundSyncStatus, "error");
  assert.equal(state.appUpdate.required, true);
  assert.equal(state.appUpdate.promptVisible, true);
  assert.equal(state.appUpdate.version, "0.1.36");
  assert.equal(state.appUpdate.currentVersion, "0.1.35");
  assert.equal(state.appUpdate.message, "Update before syncing this project.");
});
