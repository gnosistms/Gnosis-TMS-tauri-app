import test from "node:test";
import assert from "node:assert/strict";

const localStorageState = new Map();
const invokeLog = [];
let invokeHandler = async () => null;

const fakeApp = {
  addEventListener() {},
  firstElementChild: null,
  innerHTML: "",
};

const fakeDocument = {
  activeElement: null,
  querySelector(selector) {
    return selector === "#app" ? fakeApp : null;
  },
  querySelectorAll() {
    return [];
  },
  addEventListener() {},
  body: {
    append() {},
    contains() {
      return false;
    },
  },
  documentElement: {
    classList: {
      remove() {},
      toggle() {},
    },
  },
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

function deferred() {
  let resolve = null;
  let reject = null;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

globalThis.document = fakeDocument;
globalThis.navigator = {
  platform: "MacIntel",
  userAgentData: null,
};
globalThis.performance = {
  now() {
    return 0;
  },
};
globalThis.window = {
  __TAURI__: {
    core: {
      invoke(command, payload = {}) {
        invokeLog.push({ command, payload });
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
  navigator: globalThis.navigator,
  setTimeout(callback) {
    callback();
    return 1;
  },
  clearTimeout() {},
  requestAnimationFrame(callback) {
    callback();
    return 1;
  },
  cancelAnimationFrame() {},
  open() {},
};

const {
  createEditorChapterState,
  createEditorCommentsState,
  resetSessionState,
  state,
} = await import("./state.js");
const {
  applyEditorSelectionsToProjectState,
  normalizeEditorRows,
  updateEditorChapterRow,
} = await import("./editor-state-flow.js");
const {
  flushDirtyEditorRows,
  toggleEditorRowFieldMarker,
} = await import("./editor-persistence-flow.js");
const {
  enqueueRepoWrite,
  resetRepoWriteQueue,
  waitForRepoWriteQueueIdle,
} = await import("./repo-write-queue.js");
const {
  resetEditorOperationQueue,
} = await import("./editor-operation-queue.js");
const {
  deleteActiveEditorRowComment,
  saveActiveEditorRowComment,
} = await import("./editor-comments-flow.js");

function installEditorFixture() {
  resetSessionState();
  invokeLog.length = 0;
  state.selectedTeamId = "team-1";
  state.teams = [{
    id: "team-1",
    installationId: 7,
  }];
  state.projects = [{
    id: "project-1",
    name: "fixture-project",
    chapters: [{
      id: "chapter-1",
      name: "Chapter 1",
      languages: [{ code: "es", name: "Spanish" }],
    }],
  }];
  state.deletedProjects = [];
  state.screen = "translate";
  state.selectedProjectId = "project-1";
  state.selectedChapterId = "chapter-1";
  state.editorChapter = {
    ...createEditorChapterState(),
    status: "ready",
    projectId: "project-1",
    chapterId: "chapter-1",
    languages: [{ code: "es", name: "Spanish" }],
    rows: normalizeEditorRows([{
      rowId: "row-1",
      textStyle: "paragraph",
      fields: { es: "hola" },
      fieldStates: { es: { reviewed: false, pleaseCheck: false } },
    }]),
  };
}

test.afterEach(() => {
  invokeHandler = async () => null;
  invokeLog.length = 0;
  localStorageState.clear();
  resetEditorOperationQueue();
  resetRepoWriteQueue();
  resetSessionState();
});

test("flushDirtyEditorRows blocks while a style save is in flight even without dirty row tracking", async () => {
  installEditorFixture();
  state.editorChapter.rows[0] = {
    ...state.editorChapter.rows[0],
    textStyleSaveState: {
      status: "saving",
      error: "",
    },
  };

  const flushed = await flushDirtyEditorRows(() => {});

  assert.equal(flushed, false);
  assert.deepEqual(invokeLog, []);
});

test("non-durable dirty row flush enqueues row text save without waiting for the repo lane", async () => {
  installEditorFixture();
  state.editorChapter = {
    ...state.editorChapter,
    dirtyRowIds: new Set(["row-1"]),
  };
  state.editorChapter.rows[0] = {
    ...state.editorChapter.rows[0],
    fields: { es: "hola editada" },
    saveStatus: "dirty",
  };

  const blocker = deferred();
  const blockerPromise = enqueueRepoWrite({
    scope: "7:project-1:fixture-project",
    kind: "testBlocker",
    run: () => blocker.promise,
  });

  invokeHandler = async (command, payload = {}) => {
    if (command === "update_gtms_editor_row_fields") {
      return {
        status: "saved",
        row: {
          rowId: payload.input?.rowId,
          textStyle: "paragraph",
          fields: payload.input?.fields,
          fieldStates: { es: { reviewed: false, pleaseCheck: false } },
        },
        sourceWordCounts: {},
        chapterBaseCommitSha: "head-2",
      };
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  const flushed = await flushDirtyEditorRows(
    () => {},
    {
      updateEditorChapterRow,
      applyEditorSelectionsToProjectState,
    },
    { waitForDurable: false },
  );

  assert.equal(flushed, true);
  assert.equal(state.editorChapter.rows[0].saveStatus, "saving");
  assert.deepEqual(invokeLog, []);

  blocker.resolve(null);
  await blockerPromise;
  await waitForRepoWriteQueueIdle("7:project-1:fixture-project");

  assert.deepEqual(invokeLog.map((entry) => entry.command), ["update_gtms_editor_row_fields"]);
  assert.equal(state.editorChapter.rows[0].persistedFields.es, "hola editada");
  assert.equal(state.editorChapter.rows[0].saveStatus, "idle");
});

test("toggleEditorRowFieldMarker does not start a marker write while the row style is saving", async () => {
  installEditorFixture();
  state.editorChapter.rows[0] = {
    ...state.editorChapter.rows[0],
    textStyleSaveState: {
      status: "saving",
      error: "",
    },
  };

  await toggleEditorRowFieldMarker(
    () => {},
    "row-1",
    "es",
    "reviewed",
    { updateEditorChapterRow },
  );

  assert.deepEqual(invokeLog, []);
  assert.equal(state.editorChapter.rows[0].fieldStates.es.reviewed, false);
});

test("toggleEditorRowFieldMarker flushes other dirty rows before saving the marker", async () => {
  installEditorFixture();
  state.editorChapter = {
    ...state.editorChapter,
    activeRowId: "row-1",
    activeLanguageCode: "es",
    dirtyRowIds: new Set(["row-1"]),
    rows: normalizeEditorRows([
      {
        rowId: "row-1",
        textStyle: "paragraph",
        fields: { es: "hola" },
        fieldStates: { es: { reviewed: false, pleaseCheck: false } },
      },
      {
        rowId: "row-2",
        textStyle: "paragraph",
        fields: { es: "adios" },
        fieldStates: { es: { reviewed: false, pleaseCheck: false } },
      },
    ]),
  };
  state.editorChapter.rows[0] = {
    ...state.editorChapter.rows[0],
    fields: { es: "hola guardado" },
    saveStatus: "dirty",
  };

  invokeHandler = async (command, payload = {}) => {
    if (command === "update_gtms_editor_row_fields") {
      assert.equal(payload.input?.rowId, "row-1");
      return {
        status: "saved",
        row: {
          rowId: "row-1",
          textStyle: "paragraph",
          fields: { es: "hola guardado" },
          fieldStates: { es: { reviewed: false, pleaseCheck: false } },
        },
        sourceWordCounts: {},
        chapterBaseCommitSha: "head-1",
      };
    }

    if (command === "update_gtms_editor_row_field_flag") {
      assert.equal(payload.input?.rowId, "row-2");
      return {
        reviewed: true,
        pleaseCheck: false,
        chapterBaseCommitSha: "head-2",
      };
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  await toggleEditorRowFieldMarker(
    () => {},
    "row-2",
    "es",
    "reviewed",
    {
      updateEditorChapterRow,
      applyEditorSelectionsToProjectState() {},
    },
  );
  await waitForRepoWriteQueueIdle("7:project-1:fixture-project");

  assert.deepEqual(invokeLog.map((entry) => entry.command), [
    "update_gtms_editor_row_fields",
    "load_gtms_editor_field_history",
    "update_gtms_editor_row_field_flag",
  ]);
  assert.equal(state.editorChapter.rows[0].persistedFields.es, "hola guardado");
  assert.equal(state.editorChapter.rows[0].saveStatus, "idle");
  assert.equal(state.editorChapter.rows[1].fieldStates.es.reviewed, true);
});

test("toggleEditorRowFieldMarker lets the latest repeated click win while save is pending", async () => {
  installEditorFixture();
  const firstMarkerSave = deferred();
  let markerCallCount = 0;

  invokeHandler = async (command, payload = {}) => {
    if (command === "update_gtms_editor_row_field_flag") {
      markerCallCount += 1;
      if (markerCallCount === 1) {
        assert.equal(payload.input?.enabled, true);
        return firstMarkerSave.promise;
      }
      assert.equal(payload.input?.enabled, false);
      return {
        reviewed: false,
        pleaseCheck: false,
        chapterBaseCommitSha: "head-3",
      };
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  await toggleEditorRowFieldMarker(
    () => {},
    "row-1",
    "es",
    "please-check",
    {
      updateEditorChapterRow,
      applyEditorSelectionsToProjectState,
    },
  );
  assert.equal(state.editorChapter.rows[0].fieldStates.es.pleaseCheck, true);

  await toggleEditorRowFieldMarker(
    () => {},
    "row-1",
    "es",
    "please-check",
    {
      updateEditorChapterRow,
      applyEditorSelectionsToProjectState,
    },
  );
  assert.equal(state.editorChapter.rows[0].fieldStates.es.pleaseCheck, false);
  assert.equal(state.editorChapter.rows[0].markerSaveState.status, "saving");

  firstMarkerSave.resolve({
    reviewed: false,
    pleaseCheck: true,
    chapterBaseCommitSha: "head-2",
  });
  await waitForRepoWriteQueueIdle("7:project-1:fixture-project");

  assert.deepEqual(
    invokeLog
      .filter((entry) => entry.command === "update_gtms_editor_row_field_flag")
      .map((entry) => entry.payload.input?.enabled),
    [true, false],
  );
  assert.equal(state.editorChapter.rows[0].fieldStates.es.pleaseCheck, false);
  assert.equal(state.editorChapter.rows[0].persistedFieldStates.es.pleaseCheck, false);
  assert.equal(state.editorChapter.rows[0].markerSaveState.status, "idle");
});

test("comment saves and deletes do not start while the row style is saving", async () => {
  installEditorFixture();
  state.editorChapter.rows[0] = {
    ...state.editorChapter.rows[0],
    textStyleSaveState: {
      status: "saving",
      error: "",
    },
  };
  state.editorChapter = {
    ...state.editorChapter,
    activeRowId: "row-1",
    activeLanguageCode: "es",
    comments: {
      ...createEditorCommentsState(),
      rowId: "row-1",
      status: "ready",
      draft: "Check this line.",
      entries: [{
        commentId: "comment-1",
        authorLogin: "fixture-user",
        authorName: "Fixture User",
        body: "Existing comment",
        createdAt: "2026-04-17T00:00:00Z",
      }],
    },
  };

  await saveActiveEditorRowComment(() => {});
  await deleteActiveEditorRowComment(() => {}, "comment-1");

  assert.deepEqual(invokeLog, []);
  assert.equal(state.editorChapter.comments.status, "ready");
  assert.equal(state.editorChapter.comments.draft, "Check this line.");
});
