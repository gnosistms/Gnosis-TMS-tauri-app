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
  markEditorRowsPersisted,
  normalizeEditorRows,
  updateEditorChapterRow,
} = await import("./editor-state-flow.js");
const {
  confirmEditorClearTranslations,
  confirmEditorUnreviewAll,
  flushDirtyEditorRows,
  toggleEditorRowFieldMarker,
  updateEditorRowTextStyle,
} = await import("./editor-persistence-flow.js");
const {
  restoreEditorFieldHistory,
} = await import("./editor-history-flow.js");
const {
  replaceSelectedEditorRows,
} = await import("./editor-search-flow.js");
const {
  softDeleteEditorRow,
} = await import("./editor-row-structure-flow.js");
const {
  submitTargetLanguageManager,
} = await import("./editor-target-language-manager-flow.js");
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
    fullName: "org/fixture-project",
    defaultBranchName: "main",
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

test("flushDirtyEditorRows removes empty unreferenced footnotes from live state without persisting", async () => {
  installEditorFixture();
  state.editorChapter = {
    ...state.editorChapter,
    dirtyRowIds: new Set(["row-1"]),
  };
  state.editorChapter.rows[0] = {
    ...state.editorChapter.rows[0],
    fields: { es: "hola" },
    persistedFields: { es: "hola" },
    footnotes: {
      es: [
        { marker: 1, text: "kept note" },
        { marker: 2, text: "" },
      ],
    },
    persistedFootnotes: {
      es: [{ marker: 1, text: "kept note" }],
    },
    saveStatus: "dirty",
  };
  const renderScopes = [];

  const flushed = await flushDirtyEditorRows(
    (request = {}) => {
      renderScopes.push(request.scope ?? "full");
    },
    {
      updateEditorChapterRow,
      applyEditorSelectionsToProjectState,
    },
    { rowIds: ["row-1"] },
  );

  assert.equal(flushed, true);
  assert.deepEqual(state.editorChapter.rows[0].footnotes.es, [{ marker: 1, text: "kept note" }]);
  assert.deepEqual(invokeLog, []);
  assert.ok(renderScopes.includes("translate-body"));
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

test("queued repeated row saves rebase on the previous save instead of conflicting", async () => {
  installEditorFixture();
  state.editorChapter = {
    ...state.editorChapter,
    dirtyRowIds: new Set(["row-1"]),
  };
  state.editorChapter.rows[0] = {
    ...state.editorChapter.rows[0],
    fields: { es: "hola uno" },
    saveStatus: "dirty",
  };

  const firstSave = deferred();
  const capturedInputs = [];
  let diskFields = { es: "hola" };
  invokeHandler = async (command, payload = {}) => {
    if (command === "update_gtms_editor_row_fields") {
      const input = structuredClone(payload.input);
      capturedInputs.push(input);
      if (capturedInputs.length === 1) {
        await firstSave.promise;
      }
      if (input.baseFields?.es !== diskFields.es) {
        return {
          status: "conflict",
          row: {
            rowId: input.rowId,
            textStyle: "paragraph",
            fields: diskFields,
            footnotes: {},
            imageCaptions: {},
            images: {},
            fieldStates: { es: { reviewed: false, pleaseCheck: false } },
          },
        };
      }
      diskFields = { ...input.fields };
      return {
        status: "saved",
        row: {
          rowId: input.rowId,
          textStyle: "paragraph",
          fields: input.fields,
          footnotes: {},
          imageCaptions: {},
          images: {},
          fieldStates: { es: { reviewed: false, pleaseCheck: false } },
        },
        sourceWordCounts: {},
        chapterBaseCommitSha: `head-${capturedInputs.length + 1}`,
      };
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  await flushDirtyEditorRows(
    () => {},
    {
      updateEditorChapterRow,
      applyEditorSelectionsToProjectState,
    },
    { waitForDurable: false },
  );
  assert.equal(state.editorChapter.rows[0].saveStatus, "saving");

  state.editorChapter.rows[0] = {
    ...state.editorChapter.rows[0],
    fields: { es: "hola dos" },
    saveStatus: "dirty",
  };
  state.editorChapter.dirtyRowIds = new Set(["row-1"]);
  await flushDirtyEditorRows(
    () => {},
    {
      updateEditorChapterRow,
      applyEditorSelectionsToProjectState,
    },
    { waitForDurable: false },
  );

  firstSave.resolve();
  await waitForRepoWriteQueueIdle("7:project-1:fixture-project");

  assert.equal(capturedInputs.length, 2);
  assert.equal(capturedInputs[0].baseFields.es, "hola");
  assert.equal(capturedInputs[1].baseFields.es, "hola uno");
  assert.equal(state.editorChapter.rows[0].fields.es, "hola dos");
  assert.equal(state.editorChapter.rows[0].persistedFields.es, "hola dos");
  assert.equal(state.editorChapter.rows[0].saveStatus, "idle");
  assert.equal(state.editorChapter.rows[0].freshness, "fresh");
});

test("queued repeated footnote saves preserve marker bases instead of conflicting", async () => {
  installEditorFixture();
  state.editorChapter = {
    ...state.editorChapter,
    dirtyRowIds: new Set(["row-1"]),
  };
  state.editorChapter.rows[0] = {
    ...state.editorChapter.rows[0],
    fields: { es: "hola [2]" },
    persistedFields: { es: "hola [2]" },
    baseFields: { es: "hola [2]" },
    footnotes: { es: [{ marker: 2, text: "nota uno" }] },
    persistedFootnotes: { es: [{ marker: 2, text: "nota" }] },
    baseFootnotes: { es: [{ marker: 2, text: "nota" }] },
    saveStatus: "dirty",
  };

  const firstSave = deferred();
  const capturedInputs = [];
  let diskFootnotes = { es: "[2] nota" };
  invokeHandler = async (command, payload = {}) => {
    if (command === "update_gtms_editor_row_fields") {
      const input = structuredClone(payload.input);
      capturedInputs.push(input);
      if (capturedInputs.length === 1) {
        await firstSave.promise;
      }
      if (input.baseFootnotes?.es !== diskFootnotes.es) {
        return {
          status: "conflict",
          row: {
            rowId: input.rowId,
            textStyle: "paragraph",
            fields: input.fields,
            footnotes: diskFootnotes,
            imageCaptions: {},
            images: {},
            fieldStates: { es: { reviewed: false, pleaseCheck: false } },
          },
        };
      }
      diskFootnotes = { ...input.footnotes };
      return {
        status: "saved",
        row: {
          rowId: input.rowId,
          textStyle: "paragraph",
          fields: input.fields,
          footnotes: input.footnotes,
          imageCaptions: {},
          images: {},
          fieldStates: { es: { reviewed: false, pleaseCheck: false } },
        },
        sourceWordCounts: {},
        chapterBaseCommitSha: `head-footnote-${capturedInputs.length + 1}`,
      };
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  await flushDirtyEditorRows(
    () => {},
    {
      updateEditorChapterRow,
      applyEditorSelectionsToProjectState,
    },
    { waitForDurable: false },
  );

  state.editorChapter.rows[0] = {
    ...state.editorChapter.rows[0],
    footnotes: { es: [{ marker: 2, text: "nota dos" }] },
    saveStatus: "dirty",
  };
  state.editorChapter.dirtyRowIds = new Set(["row-1"]);
  await flushDirtyEditorRows(
    () => {},
    {
      updateEditorChapterRow,
      applyEditorSelectionsToProjectState,
    },
    { waitForDurable: false },
  );

  firstSave.resolve();
  await waitForRepoWriteQueueIdle("7:project-1:fixture-project");

  assert.equal(capturedInputs.length, 2);
  assert.equal(capturedInputs[0].baseFootnotes.es, "[2] nota");
  assert.equal(capturedInputs[0].footnotes.es, "[2] nota uno");
  assert.equal(capturedInputs[1].baseFootnotes.es, "[2] nota uno");
  assert.equal(capturedInputs[1].footnotes.es, "[2] nota dos");
  assert.deepEqual(state.editorChapter.rows[0].persistedFootnotes.es, [{ marker: 2, text: "nota dos" }]);
  assert.equal(state.editorChapter.rows[0].saveStatus, "idle");
  assert.equal(state.editorChapter.rows[0].freshness, "fresh");
});

test("delete-all footnote save retries a mergeable stale-base conflict instead of showing a conflict", async () => {
  installEditorFixture();
  state.editorChapter = {
    ...state.editorChapter,
    dirtyRowIds: new Set(["row-1"]),
  };
  state.editorChapter.rows[0] = {
    ...state.editorChapter.rows[0],
    fields: { es: "hola" },
    persistedFields: { es: "hola [1]" },
    baseFields: { es: "hola [1]" },
    footnotes: { es: [] },
    persistedFootnotes: { es: [{ marker: 1, text: "nota" }] },
    baseFootnotes: { es: [{ marker: 1, text: "nota" }] },
    saveStatus: "dirty",
  };

  const capturedInputs = [];
  invokeHandler = async (command, payload = {}) => {
    if (command === "update_gtms_editor_row_fields") {
      const input = structuredClone(payload.input);
      capturedInputs.push(input);
      if (capturedInputs.length === 1) {
        return {
          status: "conflict",
          row: {
            rowId: input.rowId,
            textStyle: "paragraph",
            fields: { es: "hola" },
            footnotes: { es: "nota" },
            imageCaptions: {},
            images: {},
            fieldStates: { es: { reviewed: false, pleaseCheck: false } },
          },
          baseFields: { es: "hola [1]" },
          baseFootnotes: { es: "nota" },
          baseImageCaptions: {},
          sourceWordCounts: {},
          chapterBaseCommitSha: "head-delete-marker",
        };
      }
      return {
        status: "saved",
        row: {
          rowId: input.rowId,
          textStyle: "paragraph",
          fields: input.fields,
          footnotes: input.footnotes,
          imageCaptions: {},
          images: {},
          fieldStates: { es: { reviewed: false, pleaseCheck: false } },
        },
        sourceWordCounts: {},
        chapterBaseCommitSha: "head-delete-footnote",
      };
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  await flushDirtyEditorRows(
    () => {},
    {
      updateEditorChapterRow,
      applyEditorSelectionsToProjectState,
    },
    { waitForDurable: false },
  );
  await waitForRepoWriteQueueIdle("7:project-1:fixture-project");

  assert.equal(capturedInputs.length, 2);
  assert.equal(capturedInputs[0].fields.es, "hola");
  assert.equal(capturedInputs[0].footnotes.es, "");
  assert.equal(capturedInputs[1].baseFields.es, "hola");
  assert.equal(capturedInputs[1].baseFootnotes.es, "nota");
  assert.equal(capturedInputs[1].footnotes.es, "");
  assert.deepEqual(state.editorChapter.rows[0].fields, { es: "hola" });
  assert.deepEqual(state.editorChapter.rows[0].footnotes.es, []);
  assert.equal(state.editorChapter.rows[0].saveStatus, "idle");
  assert.equal(state.editorChapter.rows[0].freshness, "fresh");
  assert.equal(state.editorChapter.rows[0].conflictState, null);
});

test("successful active row save keeps optimistic history until committed history reloads", async () => {
  installEditorFixture();
  state.editorChapter = {
    ...state.editorChapter,
    activeRowId: "row-1",
    activeLanguageCode: "es",
    dirtyRowIds: new Set(["row-1"]),
    history: {
      ...state.editorChapter.history,
      status: "ready",
      rowId: "row-1",
      languageCode: "es",
      entries: [{
        commitSha: "commit-1",
        plainText: "hola",
        footnote: "",
        imageCaption: "",
        image: null,
        textStyle: "paragraph",
        reviewed: false,
        pleaseCheck: false,
      }],
    },
  };
  state.editorChapter.rows[0] = {
    ...state.editorChapter.rows[0],
    fields: { es: "hola optimista" },
    saveStatus: "dirty",
  };

  const historyReload = deferred();
  invokeHandler = async (command, payload = {}) => {
    if (command === "update_gtms_editor_row_fields") {
      return {
        status: "saved",
        row: {
          rowId: payload.input?.rowId,
          textStyle: "paragraph",
          fields: payload.input?.fields,
          footnotes: {},
          imageCaptions: {},
          images: {},
          fieldStates: { es: { reviewed: false, pleaseCheck: false } },
        },
        sourceWordCounts: {},
        chapterBaseCommitSha: "head-2",
      };
    }
    if (command === "load_gtms_editor_field_history") {
      return historyReload.promise;
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  await flushDirtyEditorRows(
    () => {},
    {
      updateEditorChapterRow,
      applyEditorSelectionsToProjectState,
    },
    { waitForDurable: false },
  );
  await waitForRepoWriteQueueIdle("7:project-1:fixture-project");

  assert.equal(state.editorChapter.history.entries[0].optimistic, true);
  assert.equal(state.editorChapter.history.entries[0].plainText, "hola optimista");

  historyReload.resolve({
    entries: [{
      commitSha: "commit-2",
      plainText: "hola optimista",
      footnote: "",
      imageCaption: "",
      image: null,
      textStyle: "paragraph",
      reviewed: false,
      pleaseCheck: false,
    }],
  });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(state.editorChapter.history.entries[0].commitSha, "commit-2");
  assert.equal(state.editorChapter.history.entries[0].optimistic, undefined);
});

test("row save conflict clears active optimistic history", async () => {
  installEditorFixture();
  state.editorChapter = {
    ...state.editorChapter,
    activeRowId: "row-1",
    activeLanguageCode: "es",
    dirtyRowIds: new Set(["row-1"]),
    history: {
      ...state.editorChapter.history,
      status: "ready",
      rowId: "row-1",
      languageCode: "es",
      entries: [{
        commitSha: "commit-1",
        plainText: "hola",
        footnote: "",
        imageCaption: "",
        image: null,
        textStyle: "paragraph",
        reviewed: false,
        pleaseCheck: false,
      }],
    },
  };
  state.editorChapter.rows[0] = {
    ...state.editorChapter.rows[0],
    fields: { es: "hola conflictiva" },
    saveStatus: "dirty",
  };

  invokeHandler = async (command) => {
    if (command === "update_gtms_editor_row_fields") {
      return {
        status: "conflict",
        row: {
          rowId: "row-1",
          textStyle: "paragraph",
          fields: { es: "remote" },
          fieldStates: { es: { reviewed: false, pleaseCheck: false } },
        },
      };
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  await flushDirtyEditorRows(
    () => {},
    {
      updateEditorChapterRow,
      applyEditorSelectionsToProjectState,
    },
    { waitForDurable: false },
  );
  await waitForRepoWriteQueueIdle("7:project-1:fixture-project");

  assert.equal(state.editorChapter.history.entries.some((entry) => entry.optimistic === true), false);
  assert.equal(state.editorChapter.history.entries[0].commitSha, "commit-1");
  assert.equal(state.editorChapter.rows[0].freshness, "conflict");
});

test("toggleEditorRowFieldMarker stays clickable while the row style is saving", async () => {
  installEditorFixture();
  state.editorChapter.rows[0] = {
    ...state.editorChapter.rows[0],
    textStyleSaveState: {
      status: "saving",
      error: "",
    },
  };
  invokeHandler = async (command, payload = {}) => {
    if (command === "update_gtms_editor_row_field_flag") {
      assert.equal(payload.input?.rowId, "row-1");
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
    "row-1",
    "es",
    "reviewed",
    { updateEditorChapterRow },
  );
  await waitForRepoWriteQueueIdle("7:project-1:fixture-project");

  assert.deepEqual(invokeLog.map((entry) => entry.command), ["update_gtms_editor_row_field_flag"]);
  assert.equal(state.editorChapter.rows[0].fieldStates.es.reviewed, true);
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

test("queued marker write is cancelled before Tauri when preceding row save finds a conflict", async () => {
  installEditorFixture();
  state.editorChapter = {
    ...state.editorChapter,
    dirtyRowIds: new Set(["row-1"]),
  };
  state.editorChapter.rows[0] = {
    ...state.editorChapter.rows[0],
    fields: { es: "local edit" },
    saveStatus: "dirty",
  };

  invokeHandler = async (command, payload = {}) => {
    if (command === "update_gtms_editor_row_fields") {
      assert.equal(payload.input?.rowId, "row-1");
      return {
        status: "conflict",
        row: {
          rowId: "row-1",
          textStyle: "paragraph",
          fields: { es: "remote edit" },
          fieldStates: { es: { reviewed: false, pleaseCheck: false } },
        },
        baseFields: { es: "hola" },
        baseFootnotes: {},
        baseImageCaptions: {},
      };
    }
    if (command === "update_gtms_editor_row_field_flag") {
      throw new Error("marker write should not run after a row conflict");
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
  await waitForRepoWriteQueueIdle("7:project-1:fixture-project");

  assert.deepEqual(invokeLog.map((entry) => entry.command), ["update_gtms_editor_row_fields"]);
  assert.equal(state.editorChapter.rows[0].freshness, "conflict");
  assert.equal(state.editorChapter.rows[0].fieldStates.es.pleaseCheck, false);
  assert.equal(state.editorChapter.rows[0].markerSaveState.status, "idle");
});

test("updateEditorRowTextStyle lets the latest repeated style change win while save is pending", async () => {
  installEditorFixture();
  const firstStyleSave = deferred();
  let styleCallCount = 0;

  invokeHandler = async (command, payload = {}) => {
    if (command === "update_gtms_editor_row_text_style") {
      styleCallCount += 1;
      if (styleCallCount === 1) {
        assert.equal(payload.input?.textStyle, "heading1");
        return firstStyleSave.promise;
      }
      assert.equal(payload.input?.textStyle, "quote");
      return {
        textStyle: "quote",
        chapterBaseCommitSha: "head-3",
      };
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  await updateEditorRowTextStyle(
    () => {},
    "row-1",
    "heading1",
    {
      updateEditorChapterRow,
      applyEditorSelectionsToProjectState,
    },
  );
  assert.equal(state.editorChapter.rows[0].textStyle, "heading1");

  await updateEditorRowTextStyle(
    () => {},
    "row-1",
    "quote",
    {
      updateEditorChapterRow,
      applyEditorSelectionsToProjectState,
    },
  );
  assert.equal(state.editorChapter.rows[0].textStyle, "quote");
  assert.equal(state.editorChapter.rows[0].textStyleSaveState.status, "saving");

  firstStyleSave.resolve({
    textStyle: "heading1",
    chapterBaseCommitSha: "head-2",
  });
  await waitForRepoWriteQueueIdle("7:project-1:fixture-project");

  assert.deepEqual(
    invokeLog
      .filter((entry) => entry.command === "update_gtms_editor_row_text_style")
      .map((entry) => entry.payload.input?.textStyle),
    ["heading1", "quote"],
  );
  assert.equal(state.editorChapter.rows[0].textStyle, "quote");
  assert.equal(state.editorChapter.rows[0].textStyleSaveState.status, "idle");
});

test("updateEditorRowTextStyle rolls latest failures back to the last committed style", async () => {
  installEditorFixture();
  const firstStyleSave = deferred();
  let styleCallCount = 0;

  invokeHandler = async (command, payload = {}) => {
    if (command === "update_gtms_editor_row_text_style") {
      styleCallCount += 1;
      if (styleCallCount === 1) {
        assert.equal(payload.input?.textStyle, "heading1");
        return firstStyleSave.promise;
      }
      assert.equal(payload.input?.textStyle, "quote");
      throw new Error("style rejected");
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  await updateEditorRowTextStyle(
    () => {},
    "row-1",
    "heading1",
    {
      updateEditorChapterRow,
      applyEditorSelectionsToProjectState,
    },
  );
  await updateEditorRowTextStyle(
    () => {},
    "row-1",
    "quote",
    {
      updateEditorChapterRow,
      applyEditorSelectionsToProjectState,
    },
  );

  firstStyleSave.resolve({
    textStyle: "heading1",
    chapterBaseCommitSha: "head-2",
  });
  await waitForRepoWriteQueueIdle("7:project-1:fixture-project");

  assert.deepEqual(
    invokeLog
      .filter((entry) => entry.command === "update_gtms_editor_row_text_style")
      .map((entry) => entry.payload.input?.textStyle),
    ["heading1", "quote"],
  );
  assert.equal(state.editorChapter.rows[0].textStyle, "heading1");
  assert.equal(state.editorChapter.rows[0].persistedTextStyle, "heading1");
  assert.equal(state.editorChapter.rows[0].textStyleSaveState.status, "idle");
  assert.equal(state.editorChapter.rows[0].textStyleSaveState.error, "style rejected");
});

test("updateEditorRowTextStyle rerenders the active-row sidebar for live review diff updates", async () => {
  installEditorFixture();
  state.editorChapter = {
    ...state.editorChapter,
    activeRowId: "row-1",
    activeLanguageCode: "es",
    sidebarTab: "review",
  };
  const renderScopes = [];
  invokeHandler = async (command, payload = {}) => {
    if (command === "update_gtms_editor_row_text_style") {
      return {
        textStyle: payload.input?.textStyle,
        chapterBaseCommitSha: "head-2",
      };
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  await updateEditorRowTextStyle(
    (request = {}) => {
      renderScopes.push(request.scope ?? "full");
    },
    "row-1",
    "heading1",
    {
      updateEditorChapterRow,
      applyEditorSelectionsToProjectState,
    },
  );
  await waitForRepoWriteQueueIdle("7:project-1:fixture-project");

  assert.ok(renderScopes.includes("translate-body"));
  assert.ok(renderScopes.includes("translate-sidebar"));
});

test("updateEditorRowTextStyle stays clickable while row text save is pending", async () => {
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
    if (command === "update_gtms_editor_row_text_style") {
      return {
        textStyle: payload.input?.textStyle,
        chapterBaseCommitSha: "head-3",
      };
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  await updateEditorRowTextStyle(
    () => {},
    "row-1",
    "heading1",
    {
      updateEditorChapterRow,
      applyEditorSelectionsToProjectState,
    },
  );

  assert.equal(state.editorChapter.rows[0].textStyle, "heading1");
  assert.equal(state.editorChapter.rows[0].textStyleSaveState.status, "saving");
  assert.deepEqual(invokeLog, []);

  blocker.resolve(null);
  await blockerPromise;
  await waitForRepoWriteQueueIdle("7:project-1:fixture-project");

  assert.deepEqual(invokeLog.map((entry) => entry.command), [
    "update_gtms_editor_row_fields",
    "update_gtms_editor_row_text_style",
  ]);
  assert.equal(state.editorChapter.rows[0].textStyle, "heading1");
  assert.equal(state.editorChapter.rows[0].textStyleSaveState.status, "idle");
});

test("comment saves and deletes stay clickable while the row style is saving", async () => {
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
  invokeHandler = async (command, payload = {}) => {
    if (command === "save_gtms_editor_row_comment") {
      assert.equal(payload.input?.rowId, "row-1");
      return {
        commentCount: 2,
        commentsRevision: 2,
        comments: [
          {
            commentId: "comment-2",
            authorLogin: "fixture-user",
            authorName: "Fixture User",
            body: payload.input?.body,
            createdAt: "2026-04-17T00:01:00Z",
          },
          {
            commentId: "comment-1",
            authorLogin: "fixture-user",
            authorName: "Fixture User",
            body: "Existing comment",
            createdAt: "2026-04-17T00:00:00Z",
          },
        ],
        chapterBaseCommitSha: "head-2",
      };
    }
    if (command === "delete_gtms_editor_row_comment") {
      assert.equal(payload.input?.commentId, "comment-1");
      return {
        commentCount: 1,
        commentsRevision: 3,
        comments: [{
          commentId: "comment-2",
          authorLogin: "fixture-user",
          authorName: "Fixture User",
          body: "Check this line.",
          createdAt: "2026-04-17T00:01:00Z",
        }],
        chapterBaseCommitSha: "head-3",
      };
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  await saveActiveEditorRowComment(() => {});
  await deleteActiveEditorRowComment(() => {}, "comment-1");
  await waitForRepoWriteQueueIdle("7:project-1:fixture-project");

  assert.deepEqual(invokeLog.map((entry) => entry.command), [
    "save_gtms_editor_row_comment",
    "delete_gtms_editor_row_comment",
  ]);
  assert.equal(state.editorChapter.comments.status, "ready");
  assert.deepEqual(state.editorChapter.comments.entries.map((entry) => entry.commentId), ["comment-2"]);
});

test("replace selected queues behind active repo writes and captures the selected rows", async () => {
  installEditorFixture();
  state.editorChapter = {
    ...state.editorChapter,
    filters: {
      searchQuery: "hola",
      caseSensitive: false,
      rowFilterMode: "show-all",
    },
    replace: {
      enabled: true,
      replaceQuery: "ciao",
      selectedRowIds: new Set(["row-1"]),
      status: "idle",
      error: "",
    },
    rows: normalizeEditorRows([
      {
        rowId: "row-1",
        textStyle: "paragraph",
        fields: { es: "hola uno" },
        fieldStates: { es: { reviewed: false, pleaseCheck: false } },
      },
      {
        rowId: "row-2",
        textStyle: "paragraph",
        fields: { es: "hola dos" },
        fieldStates: { es: { reviewed: false, pleaseCheck: false } },
      },
    ]),
  };

  const blocker = deferred();
  const blockerPromise = enqueueRepoWrite({
    scope: "7:project-1:fixture-project",
    kind: "testBlocker",
    run: () => blocker.promise,
  });
  invokeHandler = async (command, payload = {}) => {
    if (command === "update_gtms_editor_row_fields_batch") {
      return {
        rowIds: payload.input?.rows?.map((row) => row.rowId) ?? [],
        sourceWordCounts: {},
        chapterBaseCommitSha: "head-replace",
      };
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  await replaceSelectedEditorRows(() => {}, {
    markEditorRowsPersisted,
    loadActiveEditorFieldHistory() {},
  });
  state.editorChapter = {
    ...state.editorChapter,
    replace: {
      ...state.editorChapter.replace,
      selectedRowIds: new Set(["row-2"]),
    },
  };

  assert.equal(state.editorChapter.replace.status, "saving");
  assert.deepEqual(invokeLog, []);

  blocker.resolve(null);
  await blockerPromise;
  await waitForRepoWriteQueueIdle("7:project-1:fixture-project");

  assert.deepEqual(invokeLog.map((entry) => entry.command), ["update_gtms_editor_row_fields_batch"]);
  assert.deepEqual(invokeLog[0].payload.input.rows.map((row) => row.rowId), ["row-1"]);
  assert.equal(state.editorChapter.rows[0].fields.es, "ciao uno");
  assert.equal(state.editorChapter.rows[1].fields.es, "hola dos");
  assert.equal(state.editorChapter.replace.status, "idle");
});

test("replace selected fails before Tauri when a selected row is edited while queued", async () => {
  installEditorFixture();
  state.editorChapter = {
    ...state.editorChapter,
    filters: {
      searchQuery: "hola",
      caseSensitive: false,
      rowFilterMode: "show-all",
    },
    replace: {
      enabled: true,
      replaceQuery: "ciao",
      selectedRowIds: new Set(["row-1"]),
      status: "idle",
      error: "",
    },
    rows: normalizeEditorRows([{
      rowId: "row-1",
      textStyle: "paragraph",
      fields: { es: "hola uno" },
      fieldStates: { es: { reviewed: false, pleaseCheck: false } },
    }]),
  };

  const blocker = deferred();
  const blockerPromise = enqueueRepoWrite({
    scope: "7:project-1:fixture-project",
    kind: "testBlocker",
    run: () => blocker.promise,
  });
  invokeHandler = async (command) => {
    if (command === "update_gtms_editor_row_fields_batch") {
      throw new Error("replace batch should not run after a selected row changes");
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  await replaceSelectedEditorRows(() => {}, {
    markEditorRowsPersisted,
    loadActiveEditorFieldHistory() {},
  });
  state.editorChapter.rows[0] = {
    ...state.editorChapter.rows[0],
    fields: { es: "hola local edit" },
    saveStatus: "dirty",
  };

  blocker.resolve(null);
  await blockerPromise;
  await waitForRepoWriteQueueIdle("7:project-1:fixture-project");

  assert.deepEqual(invokeLog, []);
  assert.equal(state.editorChapter.rows[0].fields.es, "hola local edit");
  assert.equal(state.editorChapter.replace.status, "idle");
  assert.match(state.editorChapter.replace.error, /selected rows/);
});

test("restore history coalesces queued repeated restores to the latest commit", async () => {
  installEditorFixture();
  state.editorChapter = {
    ...state.editorChapter,
    activeRowId: "row-1",
    activeLanguageCode: "es",
    history: {
      ...state.editorChapter.history,
      rowId: "row-1",
      languageCode: "es",
      entries: [
        {
          commitSha: "commit-2",
          plainText: "optimistic text from commit-2",
          footnote: "",
          imageCaption: "",
          image: null,
          textStyle: "paragraph",
          reviewed: false,
          pleaseCheck: false,
        },
        {
          commitSha: "commit-1",
          plainText: "optimistic text from commit-1",
          footnote: "",
          imageCaption: "",
          image: null,
          textStyle: "paragraph",
          reviewed: false,
          pleaseCheck: false,
        },
      ],
    },
  };

  const blocker = deferred();
  const blockerPromise = enqueueRepoWrite({
    scope: "7:project-1:fixture-project",
    kind: "testBlocker",
    run: () => blocker.promise,
  });
  invokeHandler = async (command, payload = {}) => {
    if (command === "restore_gtms_editor_field_from_history") {
      return {
        rowId: payload.input?.rowId,
        languageCode: payload.input?.languageCode,
        plainText: `text from ${payload.input?.commitSha}`,
        footnote: "",
        imageCaption: "",
        image: null,
        textStyle: "paragraph",
        reviewed: false,
        pleaseCheck: false,
        sourceWordCounts: {},
        chapterBaseCommitSha: `head-${payload.input?.commitSha}`,
      };
    }
    if (command === "load_gtms_editor_field_history") {
      return { entries: [] };
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  await restoreEditorFieldHistory(() => {}, "commit-1", {
    updateEditorChapterRow,
    reconcileDirtyTrackedEditorRows() {},
    applyEditorSelectionsToProjectState,
  });
  assert.equal(state.editorChapter.rows[0].fields.es, "optimistic text from commit-1");
  assert.equal(state.editorChapter.rows[0].saveStatus, "saving");

  await restoreEditorFieldHistory(() => {}, "commit-2", {
    updateEditorChapterRow,
    reconcileDirtyTrackedEditorRows() {},
    applyEditorSelectionsToProjectState,
  });
  assert.equal(state.editorChapter.rows[0].fields.es, "optimistic text from commit-2");

  assert.equal(state.editorChapter.history.restoringCommitSha, "commit-2");
  assert.deepEqual(invokeLog, []);

  blocker.resolve(null);
  await blockerPromise;
  await waitForRepoWriteQueueIdle("7:project-1:fixture-project");

  const restoreCalls = invokeLog.filter((entry) => entry.command === "restore_gtms_editor_field_from_history");
  assert.equal(restoreCalls.length, 1);
  assert.equal(restoreCalls[0].payload.input.commitSha, "commit-2");
  assert.equal(state.editorChapter.rows[0].fields.es, "text from commit-2");
  assert.equal(state.editorChapter.history.restoringCommitSha, null);
});

test("restore history rolls back the optimistic row when the queued restore fails", async () => {
  installEditorFixture();
  state.editorChapter = {
    ...state.editorChapter,
    activeRowId: "row-1",
    activeLanguageCode: "es",
    history: {
      ...state.editorChapter.history,
      rowId: "row-1",
      languageCode: "es",
      entries: [{
        commitSha: "commit-1",
        plainText: "optimistic restore",
        footnote: "",
        imageCaption: "",
        image: null,
        textStyle: "paragraph",
        reviewed: false,
        pleaseCheck: false,
      }],
    },
  };

  const blocker = deferred();
  const blockerPromise = enqueueRepoWrite({
    scope: "7:project-1:fixture-project",
    kind: "testBlocker",
    run: () => blocker.promise,
  });
  invokeHandler = async (command) => {
    if (command === "restore_gtms_editor_field_from_history") {
      throw new Error("restore failed");
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  await restoreEditorFieldHistory(() => {}, "commit-1", {
    updateEditorChapterRow,
    reconcileDirtyTrackedEditorRows() {},
    applyEditorSelectionsToProjectState,
  });

  assert.equal(state.editorChapter.rows[0].fields.es, "optimistic restore");
  assert.equal(state.editorChapter.rows[0].saveStatus, "saving");

  blocker.resolve(null);
  await blockerPromise;
  await waitForRepoWriteQueueIdle("7:project-1:fixture-project");

  assert.equal(state.editorChapter.rows[0].fields.es, "hola");
  assert.equal(state.editorChapter.rows[0].saveStatus, "idle");
  assert.equal(state.editorChapter.history.restoringCommitSha, null);
});

test("unreview all queues behind dirty row text instead of blocking on the save", async () => {
  installEditorFixture();
  state.editorChapter = {
    ...state.editorChapter,
    dirtyRowIds: new Set(["row-1"]),
    unreviewAllModal: {
      ...state.editorChapter.unreviewAllModal,
      isOpen: true,
      languageCode: "es",
      status: "idle",
      error: "",
    },
  };
  state.editorChapter.rows[0] = {
    ...state.editorChapter.rows[0],
    fields: { es: "hola editada" },
    fieldStates: { es: { reviewed: true, pleaseCheck: true } },
    saveStatus: "dirty",
  };

  invokeHandler = async (command, payload = {}) => {
    if (command === "update_gtms_editor_row_fields") {
      return {
        status: "saved",
        row: {
          rowId: payload.input?.rowId,
          textStyle: "paragraph",
          fields: payload.input?.fields,
          fieldStates: { es: { reviewed: true, pleaseCheck: true } },
        },
        sourceWordCounts: {},
        chapterBaseCommitSha: "head-row",
      };
    }
    if (command === "clear_gtms_editor_reviewed_markers") {
      return {
        rowIds: ["row-1"],
        chapterBaseCommitSha: "head-unreview",
      };
    }
    if (command === "load_gtms_editor_field_history") {
      return { entries: [] };
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  await confirmEditorUnreviewAll(() => {}, {
    updateEditorChapterRow,
    applyEditorSelectionsToProjectState,
  });
  await waitForRepoWriteQueueIdle("7:project-1:fixture-project");

  assert.deepEqual(invokeLog.map((entry) => entry.command), [
    "update_gtms_editor_row_fields",
    "clear_gtms_editor_reviewed_markers",
  ]);
  assert.equal(state.editorChapter.rows[0].fieldStates.es.reviewed, false);
  assert.equal(state.editorChapter.rows[0].fieldStates.es.pleaseCheck, true);
});

test("clear translations queues behind dirty row text instead of blocking on the save", async () => {
  installEditorFixture();
  state.editorChapter = {
    ...state.editorChapter,
    dirtyRowIds: new Set(["row-1"]),
    clearTranslationsModal: {
      ...state.editorChapter.clearTranslationsModal,
      isOpen: true,
      step: "confirm",
      selectedLanguageCodes: ["es"],
      status: "idle",
      error: "",
    },
  };
  state.editorChapter.rows[0] = {
    ...state.editorChapter.rows[0],
    fields: { es: "hola editada" },
    saveStatus: "dirty",
  };

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
        chapterBaseCommitSha: "head-row",
      };
    }
    if (command === "update_gtms_editor_row_fields_batch") {
      return {
        rowIds: payload.input?.rows?.map((row) => row.rowId) ?? [],
        sourceWordCounts: {},
        chapterBaseCommitSha: "head-clear",
      };
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  await confirmEditorClearTranslations(() => {}, {
    updateEditorChapterRow,
    applyEditorSelectionsToProjectState,
  });
  await waitForRepoWriteQueueIdle("7:project-1:fixture-project");

  assert.deepEqual(invokeLog.map((entry) => entry.command), [
    "update_gtms_editor_row_fields",
    "update_gtms_editor_row_fields_batch",
  ]);
  assert.equal(state.editorChapter.rows[0].fields.es, "");
  assert.equal(state.editorChapter.clearTranslationsModal.isOpen, false);
});

test("clear translations stops before batch write when queued row save finds a conflict", async () => {
  installEditorFixture();
  state.editorChapter = {
    ...state.editorChapter,
    dirtyRowIds: new Set(["row-1"]),
    clearTranslationsModal: {
      ...state.editorChapter.clearTranslationsModal,
      isOpen: true,
      step: "confirm",
      selectedLanguageCodes: ["es"],
      status: "idle",
      error: "",
    },
  };
  state.editorChapter.rows[0] = {
    ...state.editorChapter.rows[0],
    fields: { es: "local edit" },
    saveStatus: "dirty",
  };

  invokeHandler = async (command, payload = {}) => {
    if (command === "update_gtms_editor_row_fields") {
      return {
        status: "conflict",
        row: {
          rowId: payload.input?.rowId,
          textStyle: "paragraph",
          fields: { es: "remote edit" },
          fieldStates: { es: { reviewed: false, pleaseCheck: false } },
        },
        baseFields: { es: "hola" },
        baseFootnotes: {},
        baseImageCaptions: {},
      };
    }
    if (command === "update_gtms_editor_row_fields_batch") {
      throw new Error("clear translations batch should not run after a row conflict");
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  await confirmEditorClearTranslations(() => {}, {
    updateEditorChapterRow,
    applyEditorSelectionsToProjectState,
  });
  await waitForRepoWriteQueueIdle("7:project-1:fixture-project");

  assert.deepEqual(invokeLog.map((entry) => entry.command), ["update_gtms_editor_row_fields"]);
  assert.equal(state.editorChapter.rows[0].freshness, "conflict");
  assert.equal(state.editorChapter.clearTranslationsModal.isOpen, true);
  assert.match(state.editorChapter.clearTranslationsModal.error, /Refresh or resolve/);
});

test("soft delete row queues while an existing row save is pending", async () => {
  installEditorFixture();
  state.editorChapter.rows[0] = {
    ...state.editorChapter.rows[0],
    saveStatus: "saving",
  };
  const blocker = deferred();
  const blockerPromise = enqueueRepoWrite({
    scope: "7:project-1:fixture-project",
    kind: "testBlocker",
    run: () => blocker.promise,
  });
  invokeHandler = async (command, payload = {}) => {
    if (command === "soft_delete_gtms_editor_row") {
      assert.equal(payload.input?.rowId, "row-1");
      return {
        lifecycleState: "deleted",
        sourceWordCounts: {},
        chapterBaseCommitSha: "head-delete",
      };
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  await softDeleteEditorRow(() => {}, "row-1", null, {
    applyStructuralEditorChange(_render, applyChange) {
      applyChange();
    },
    applyEditorSelectionsToProjectState,
  });

  assert.deepEqual(invokeLog, []);
  blocker.resolve(null);
  await blockerPromise;
  await waitForRepoWriteQueueIdle("7:project-1:fixture-project");

  assert.deepEqual(invokeLog.map((entry) => entry.command), ["soft_delete_gtms_editor_row"]);
  assert.equal(state.editorChapter.rows[0].lifecycleState, "deleted");
});

test("target language manager queues after dirty row saves", async () => {
  installEditorFixture();
  state.auth = {
    ...state.auth,
    session: {
      sessionToken: "session-token",
    },
  };
  state.editorChapter = {
    ...state.editorChapter,
    dirtyRowIds: new Set(["row-1"]),
  };
  state.editorChapter.rows[0] = {
    ...state.editorChapter.rows[0],
    fields: { es: "hola editada" },
    saveStatus: "dirty",
  };
  state.targetLanguageManager = {
    isOpen: true,
    status: "idle",
    error: "",
    chapterId: "chapter-1",
    languages: [
      { code: "es", name: "Spanish" },
      { code: "fr", name: "French" },
    ],
    isPickerOpen: false,
    pickerSelectedLanguageCode: "",
    pickerScrollTop: 0,
  };

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
        chapterBaseCommitSha: "head-row",
      };
    }
    if (command === "update_gtms_chapter_languages") {
      return {
        languages: payload.input?.languages ?? [],
        selectedSourceLanguageCode: "es",
        selectedTargetLanguageCode: "fr",
      };
    }
    throw new Error(`Unexpected command: ${command}`);
  };

  await submitTargetLanguageManager(() => {}, {
    applyChapterMetadataToState() {},
    flushDirtyEditorRows: (render, options) => flushDirtyEditorRows(
      render,
      {
        updateEditorChapterRow,
        applyEditorSelectionsToProjectState,
      },
      options,
    ),
    reloadSelectedChapterEditorData() {},
  });
  await waitForRepoWriteQueueIdle("7:project-1:fixture-project");

  assert.deepEqual(invokeLog.map((entry) => entry.command), [
    "update_gtms_editor_row_fields",
    "update_gtms_chapter_languages",
  ]);
  assert.deepEqual(invokeLog[1].payload.input.languages.map((language) => language.code), ["es", "fr"]);
  assert.equal(state.targetLanguageManager.isOpen, false);
});
