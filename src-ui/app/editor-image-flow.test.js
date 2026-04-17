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
  resetSessionState,
  state,
} = await import("./state.js");
const {
  normalizeEditorRows,
} = await import("./editor-state-flow.js");
const {
  submitEditorImageUrl,
} = await import("./editor-image-flow.js");

function installEditorFixture() {
  resetSessionState();
  invokeLog.length = 0;
  invokeHandler = async () => null;
  state.selectedTeamId = "team-1";
  state.teams = [{
    id: "team-1",
    installationId: 7,
  }];
  state.projects = [{
    id: "project-1",
    name: "fixture-project",
    teamId: "team-1",
    chapters: [{
      id: "chapter-1",
      name: "Chapter 1",
      languages: [
        { code: "es", name: "Spanish", role: "source" },
        { code: "vi", name: "Vietnamese", role: "target" },
      ],
      selectedSourceLanguageCode: "es",
      selectedTargetLanguageCode: "vi",
      syncState: "synced",
    }],
    syncState: "synced",
  }];
  state.selectedProjectId = "project-1";
  state.selectedChapterId = "chapter-1";
  state.editorChapter = {
    ...createEditorChapterState(),
    status: "ready",
    projectId: "project-1",
    chapterId: "chapter-1",
    languages: [
      { code: "es", name: "Spanish", role: "source" },
      { code: "vi", name: "Vietnamese", role: "target" },
    ],
    rows: normalizeEditorRows([{
      rowId: "row-1",
      orderKey: "0001",
      textStyle: "paragraph",
      fields: {
        es: "hola",
        vi: "",
      },
      footnotes: {
        es: "",
        vi: "",
      },
      images: {},
      fieldStates: {
        es: { reviewed: false, pleaseCheck: false },
        vi: { reviewed: false, pleaseCheck: false },
      },
    }]),
    imageEditor: {
      rowId: "row-1",
      languageCode: "vi",
      mode: "url",
      urlDraft: "",
      invalidUrl: false,
      status: "idle",
    },
  };
}

function createRenderSpy() {
  const calls = [];
  const render = (...args) => {
    calls.push(args);
  };
  render.calls = calls;
  return render;
}

test("submitEditorImageUrl clears an empty draft back to the pre-open state", async () => {
  installEditorFixture();
  const render = createRenderSpy();

  await submitEditorImageUrl(render, "row-1", "vi");

  assert.deepEqual(state.editorChapter.imageEditor, {
    rowId: null,
    languageCode: null,
    mode: null,
    urlDraft: "",
    invalidUrl: false,
    status: "idle",
  });
  assert.deepEqual(render.calls, [[{ scope: "translate-body" }]]);
  assert.equal(invokeLog.length, 0);
});

test("submitEditorImageUrl closes the input while a non-empty draft is being validated", async () => {
  installEditorFixture();
  const render = createRenderSpy();
  state.editorChapter = {
    ...state.editorChapter,
    imageEditor: {
      rowId: "row-1",
      languageCode: "vi",
      mode: "url",
      urlDraft: "https://example.com/image.png",
      invalidUrl: false,
      status: "idle",
    },
  };

  const pendingValidation = new Promise(() => {});
  const originalImage = globalThis.Image;
  const originalSetTimeout = globalThis.window.setTimeout;
  globalThis.Image = class {
    set onload(callback) {
      this._onload = callback;
    }

    set onerror(callback) {
      this._onerror = callback;
    }

    set src(_value) {
      void pendingValidation;
    }
  };
  globalThis.window.setTimeout = () => 1;

  try {
    const submitPromise = submitEditorImageUrl(render, "row-1", "vi");
    await Promise.resolve();

    assert.equal(state.editorChapter.imageEditor.status, "submitting");
    assert.equal(state.editorChapter.imageEditor.mode, "url");
    assert.equal(render.calls.length, 1);

    submitPromise.catch(() => {});
  } finally {
    globalThis.Image = originalImage;
    globalThis.window.setTimeout = originalSetTimeout;
  }
});
