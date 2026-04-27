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
  const fields = cloneValue(overrides.fields ?? { es: "hola", en: "hello" });
  const footnotes = cloneValue(overrides.footnotes ?? { es: "", en: "" });
  const imageCaptions = cloneValue(overrides.imageCaptions ?? { es: "", en: "" });
  const images = cloneValue(overrides.images ?? { es: null, en: null });
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
    fields,
    footnotes,
    imageCaptions,
    images,
    baseFields: cloneValue(overrides.baseFields ?? fields),
    baseFootnotes: cloneValue(overrides.baseFootnotes ?? footnotes),
    baseImageCaptions: cloneValue(overrides.baseImageCaptions ?? imageCaptions),
    baseImages: cloneValue(overrides.baseImages ?? images),
    persistedFields: cloneValue(overrides.persistedFields ?? fields),
    persistedFootnotes: cloneValue(overrides.persistedFootnotes ?? footnotes),
    persistedImageCaptions: cloneValue(overrides.persistedImageCaptions ?? imageCaptions),
    persistedImages: cloneValue(overrides.persistedImages ?? images),
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

function createRemoteChapterLoadPayload(rows, overrides = {}) {
  const nextRows = Array.isArray(rows) ? rows : [];
  return {
    chapterId: "chapter-1",
    chapterBaseCommitSha: "head-2",
    fileTitle: "Chapter 1",
    languages: [{ code: "es", name: "Spanish" }, { code: "en", name: "English" }],
    sourceWordCounts: {},
    rows: nextRows.map((row) => createRemoteRowPayload(row.rowId, {
      orderKey: row.orderKey,
      fields: {
        es: row.fields?.es ?? `hola ${row.rowId}`,
        en: `reloaded ${row.rowId}`,
      },
    })),
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

test("editor background sync stays local-only while offline", async () => {
  installEditorFixture();
  state.offline = {
    ...state.offline,
    isEnabled: true,
  };

  invokeHandler = async (command) => {
    throw new Error(`Unexpected command: ${command}`);
  };

  const render = createRenderRecorder();
  startEditorBackgroundSyncSession(render);
  await Promise.resolve();

  const syncPayload = await syncEditorBackgroundNow(render, { skipDirtyFlush: true });

  assert.equal(syncPayload, null);
  assert.deepEqual(invokeLog, []);
  assert.equal(scheduledIntervals.size, 0);
  assert.equal(state.connectionFailure.isOpen, false);
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
  startEditorBackgroundSyncSession(render, { skipInitialSync: true });
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
  startEditorBackgroundSyncSession(render, { skipInitialSync: true });
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
  startEditorBackgroundSyncSession(render, { skipInitialSync: true });
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

test("background sync auto-merges disjoint staleDirty row changes without reloading the chapter", async () => {
  installEditorFixture();
  state.editorChapter.rows = [createEditorRowFixture({
    fields: { es: "hola", en: "hello local" },
    baseFields: { es: "hola", en: "hello" },
    persistedFields: { es: "hola", en: "hello" },
    saveStatus: "dirty",
    freshness: "dirty",
  })];

  const syncRequest = deferred();
  invokeHandler = async (command) => {
    if (command === "sync_gtms_project_editor_repo") {
      return syncRequest.promise;
    }
    if (command === "load_gtms_editor_row") {
      return {
        chapterBaseCommitSha: "head-2",
        row: createRemoteRowPayload("row-1", {
          fields: { es: "hola remoto", en: "hello" },
        }),
      };
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  const render = createRenderRecorder();
  startEditorBackgroundSyncSession(render, { skipInitialSync: true });
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
  assert.deepEqual(render.calls, [{
    scope: "translate-visible-rows",
    rowIds: ["row-1"],
    reason: "background-sync-dirty-merge",
  }]);
  assert.deepEqual(state.editorChapter.rows[0]?.fields, {
    es: "hola remoto",
    en: "hello local",
  });
  assert.equal(state.editorChapter.rows[0]?.freshness, "dirty");
  assert.equal(state.editorChapter.rows[0]?.saveStatus, "dirty");
});

test("background sync promotes overlapping staleDirty text changes directly to conflict", async () => {
  installEditorFixture();
  state.editorChapter.rows = [createEditorRowFixture({
    fields: { es: "hola local", en: "hello" },
    baseFields: { es: "hola", en: "hello" },
    persistedFields: { es: "hola", en: "hello" },
    saveStatus: "dirty",
    freshness: "dirty",
  })];

  const syncRequest = deferred();
  invokeHandler = async (command) => {
    if (command === "sync_gtms_project_editor_repo") {
      return syncRequest.promise;
    }
    if (command === "load_gtms_editor_row") {
      return {
        chapterBaseCommitSha: "head-2",
        rowVersion: {
          commitSha: "abc12345",
          authorName: "Remote User",
          committedAt: "2026-04-23T01:02:03Z",
        },
        row: createRemoteRowPayload("row-1", {
          fields: { es: "hola remoto", en: "hello" },
        }),
      };
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  const render = createRenderRecorder();
  startEditorBackgroundSyncSession(render, { skipInitialSync: true });
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
  assert.deepEqual(render.calls, [{
    scope: "translate-visible-rows",
    rowIds: ["row-1"],
    reason: "background-sync-conflict",
  }]);
  assert.equal(state.editorChapter.rows[0]?.freshness, "conflict");
  assert.equal(state.editorChapter.rows[0]?.saveStatus, "conflict");
  assert.equal(state.editorChapter.rows[0]?.conflictState?.remoteVersion?.commitSha, "abc12345");
});

test("background sync resolves simultaneous marker edits to the safer state", async () => {
  installEditorFixture();
  state.editorChapter.rows = [createEditorRowFixture({
    fieldStates: {
      es: { reviewed: false, pleaseCheck: true },
      en: { reviewed: false, pleaseCheck: false },
    },
    persistedFieldStates: {
      es: { reviewed: false, pleaseCheck: false },
      en: { reviewed: false, pleaseCheck: false },
    },
    saveStatus: "dirty",
    freshness: "dirty",
  })];

  const syncRequest = deferred();
  invokeHandler = async (command) => {
    if (command === "sync_gtms_project_editor_repo") {
      return syncRequest.promise;
    }
    if (command === "load_gtms_editor_row") {
      return {
        chapterBaseCommitSha: "head-2",
        rowVersion: {
          commitSha: "abc12345",
          authorName: "Remote User",
          committedAt: "2026-04-23T01:02:03Z",
        },
        row: createRemoteRowPayload("row-1", {
          fieldStates: {
            es: { reviewed: true, pleaseCheck: false },
            en: { reviewed: false, pleaseCheck: false },
          },
        }),
      };
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  const render = createRenderRecorder();
  startEditorBackgroundSyncSession(render, { skipInitialSync: true });
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
  assert.deepEqual(render.calls, [{
    scope: "translate-visible-rows",
    rowIds: ["row-1"],
    reason: "background-sync-dirty-merge",
  }]);
  assert.deepEqual(state.editorChapter.rows[0]?.fieldStates?.es, {
    reviewed: false,
    pleaseCheck: true,
  });
  assert.equal(state.editorChapter.rows[0]?.freshness, "dirty");
  assert.equal(state.editorChapter.rows[0]?.saveStatus, "idle");
});

test("background sync uses a blocking chapter reload for large stale batches", async () => {
  installEditorFixture();
  const rows = Array.from({ length: 9 }, (_, index) => {
    const rowNumber = index + 1;
    return createEditorRowFixture({
      rowId: `row-${rowNumber}`,
      orderKey: String(rowNumber).padStart(5, "0"),
      fields: {
        es: `hola ${rowNumber}`,
        en: `hello ${rowNumber}`,
      },
      persistedFields: {
        es: `hola ${rowNumber}`,
        en: `hello ${rowNumber}`,
      },
    });
  });
  state.editorChapter.rows = rows;

  const syncRequest = deferred();
  invokeHandler = async (command) => {
    if (command === "sync_gtms_project_editor_repo") {
      return syncRequest.promise;
    }
    if (command === "load_gtms_chapter_editor_data") {
      return createRemoteChapterLoadPayload(rows);
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
    changedRowIds: rows.map((row) => row.rowId),
    deletedRowIds: [],
    insertedRowIds: [],
    newHeadSha: "head-2",
  });
  const syncResult = await pendingSync;

  assert.equal(syncResult.requiresBlockingReload, true);
  assert.equal(syncResult.performedBlockingReload, true);
  assert.equal(syncResult.blockingReloadReason, "large-batch");
  assert.equal(syncResult.requiresChapterReload, true);
  assert.deepEqual(syncResult.refreshedRowIds, []);
  assert.equal(state.navigationLoadingModal.isOpen, false);
  assert.deepEqual(
    invokeLog.filter((entry) => entry.command === "load_gtms_editor_row"),
    [],
  );
});

test("background sync uses a blocking chapter reload when the chapter language list changes", async () => {
  installEditorFixture();
  state.editorChapter.rows = [createEditorRowFixture()];

  const syncRequest = deferred();
  invokeHandler = async (command) => {
    if (command === "sync_gtms_project_editor_repo") {
      return syncRequest.promise;
    }
    if (command === "load_gtms_chapter_editor_data") {
      return createRemoteChapterLoadPayload(state.editorChapter.rows, {
        languages: [
          { code: "es", name: "Spanish" },
          { code: "en", name: "English" },
          { code: "vi", name: "Vietnamese" },
        ],
      });
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
    chapterLanguagesChanged: true,
    changedRowIds: [],
    deletedRowIds: [],
    insertedRowIds: [],
    newHeadSha: "head-2",
  });
  const syncResult = await pendingSync;

  assert.equal(syncResult.requiresBlockingReload, true);
  assert.equal(syncResult.performedBlockingReload, true);
  assert.equal(syncResult.blockingReloadReason, "chapter-languages");
  assert.equal(syncResult.requiresChapterReload, true);
  assert.equal(state.editorChapter.languages.length, 3);
});

test("background sync reloads the current chapter when semantic git resolution imports editor conflicts", async () => {
  installEditorFixture();
  state.editorChapter.rows = [createEditorRowFixture()];

  const syncRequest = deferred();
  invokeHandler = async (command) => {
    if (command === "sync_gtms_project_editor_repo") {
      return syncRequest.promise;
    }
    if (command === "load_gtms_chapter_editor_data") {
      return {
        chapterId: "chapter-1",
        chapterBaseCommitSha: "head-2",
        fileTitle: "Chapter 1",
        languages: [{ code: "es", name: "Spanish" }, { code: "en", name: "English" }],
        sourceWordCounts: {},
        rows: [{
          rowId: "row-1",
          orderKey: "00001",
          lifecycleState: "active",
          textStyle: "paragraph",
          fields: { es: "hola local", en: "hello local" },
          footnotes: { es: "", en: "" },
          imageCaptions: { es: "", en: "" },
          images: { es: null, en: null },
          fieldStates: {
            es: { reviewed: false, pleaseCheck: false },
            en: { reviewed: false, pleaseCheck: false },
          },
          importedConflict: {
            conflictKind: "text-conflict",
            remoteRow: createRemoteRowPayload("row-1", {
              fields: { es: "hola remoto", en: "hello remote" },
            }),
          },
        }],
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
    repoSyncStatus: "importedEditorConflicts",
    affectedChapterIds: ["chapter-1"],
    importedConflicts: [{
      chapterId: "chapter-1",
      rowId: "row-1",
      rowPath: "chapters/ch-1/rows/row-1.json",
      conflictKind: "text-conflict",
    }],
    changedRowIds: [],
    deletedRowIds: [],
    insertedRowIds: [],
    newHeadSha: "head-2",
  });
  const syncResult = await pendingSync;

  assert.equal(syncResult.requiresBlockingReload, true);
  assert.equal(syncResult.performedBlockingReload, true);
  assert.equal(syncResult.blockingReloadReason, "imported-editor-conflicts");
  assert.equal(syncResult.requiresChapterReload, true);
  assert.equal(state.editorChapter.rows[0]?.freshness, "conflict");
  assert.equal(state.editorChapter.rows[0]?.importedConflictKind, "text-conflict");
  assert.equal(state.editorChapter.rows[0]?.conflictState?.remoteRow?.fields?.en, "hello remote");
  assert.deepEqual(
    invokeLog.filter((entry) => entry.command === "load_gtms_editor_row"),
    [],
  );
});

test("background sync uses a blocking chapter reload for deleted rows", async () => {
  installEditorFixture();
  state.editorChapter.rows = [createEditorRowFixture()];

  const syncRequest = deferred();
  invokeHandler = async (command) => {
    if (command === "sync_gtms_project_editor_repo") {
      return syncRequest.promise;
    }
    if (command === "load_gtms_chapter_editor_data") {
      return createRemoteChapterLoadPayload([]);
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
    deletedRowIds: ["row-1"],
    insertedRowIds: [],
    newHeadSha: "head-2",
  });
  const syncResult = await pendingSync;

  assert.equal(syncResult.requiresBlockingReload, true);
  assert.equal(syncResult.performedBlockingReload, true);
  assert.equal(syncResult.blockingReloadReason, "deleted-rows");
  assert.equal(syncResult.requiresChapterReload, true);
  assert.deepEqual(syncResult.refreshedRowIds, []);
  assert.equal(state.editorChapter.rows.length, 0);
  assert.equal(state.navigationLoadingModal.isOpen, false);
  assert.deepEqual(
    invokeLog.filter((entry) => entry.command === "load_gtms_editor_row"),
    [],
  );
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

test("background sync uses a blocking chapter reload for inserted rows", async () => {
  installEditorFixture();
  const existingRow = createEditorRowFixture();
  const insertedRow = createEditorRowFixture({
    rowId: "row-2",
    orderKey: "00002",
    fields: {
      es: "hola 2",
      en: "hello 2",
    },
    persistedFields: {
      es: "hola 2",
      en: "hello 2",
    },
  });
  state.editorChapter.rows = [existingRow];

  const syncRequest = deferred();
  invokeHandler = async (command) => {
    if (command === "sync_gtms_project_editor_repo") {
      return syncRequest.promise;
    }
    if (command === "load_gtms_chapter_editor_data") {
      return createRemoteChapterLoadPayload([existingRow, insertedRow]);
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
    insertedRowIds: ["row-2"],
    newHeadSha: "head-2",
  });
  const syncResult = await pendingSync;

  assert.equal(syncResult.requiresBlockingReload, true);
  assert.equal(syncResult.performedBlockingReload, true);
  assert.equal(syncResult.blockingReloadReason, "inserted-rows");
  assert.equal(syncResult.requiresChapterReload, true);
  assert.deepEqual(syncResult.refreshedRowIds, []);
  assert.equal(state.editorChapter.rows.length, 2);
  assert.equal(state.editorChapter.rows[1]?.rowId, "row-2");
  assert.equal(state.navigationLoadingModal.isOpen, false);
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
