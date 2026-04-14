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
  setInterval() {
    return 1;
  },
  clearInterval() {},
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
globalThis.navigator = globalThis.window.navigator;

const {
  createEditorChapterState,
  resetSessionState,
  state,
} = await import("./state.js");
const { normalizeEditorRows, applyEditorUiState } = await import("./editor-state-flow.js");
const {
  applyEditorAiReview,
  runEditorAiReview,
} = await import("./editor-ai-review-flow.js");
const {
  loadAiProviderSecret,
  saveAiProviderSecret,
  updateAiProviderSecretDraft,
} = await import("./ai-settings-flow.js");
const { resolveVisibleEditorAiReview } = await import("./editor-ai-review-state.js");

function installTranslateFixture() {
  resetSessionState();
  state.screen = "translate";
  state.selectedChapterId = "chapter-1";
  state.editorChapter = {
    ...createEditorChapterState(),
    status: "ready",
    chapterId: "chapter-1",
    languages: [
      { code: "es", name: "Spanish" },
      { code: "vi", name: "Vietnamese" },
    ],
    activeRowId: "row-1",
    activeLanguageCode: "vi",
    rows: normalizeEditorRows([{
      rowId: "row-1",
      fields: {
        es: "Hola",
        vi: "Texto original",
      },
      fieldStates: {},
    }]),
  };
}

test.afterEach(() => {
  invokeHandler = async () => null;
  invokeLog.length = 0;
  localStorageState.clear();
  resetSessionState();
});

test("runEditorAiReview opens the missing-key modal when no saved key exists", async () => {
  installTranslateFixture();
  invokeHandler = async (command) => {
    if (command === "load_ai_provider_secret") {
      return null;
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  await runEditorAiReview(() => {});

  assert.equal(state.aiReviewMissingKeyModal.isOpen, true);
  assert.deepEqual(
    invokeLog.map((entry) => entry.command),
    ["load_ai_provider_secret"],
  );
});

test("applyEditorAiReview updates the editor row and clears the suggestion after save", async () => {
  installTranslateFixture();
  state.editorChapter = {
    ...state.editorChapter,
    aiReview: {
      status: "ready",
      error: "",
      rowId: "row-1",
      languageCode: "vi",
      requestKey: "req-1",
      sourceText: "Texto original",
      suggestedText: "Texto revisado",
    },
  };

  let persistCount = 0;

  await applyEditorAiReview(() => {}, {
    updateEditorRowFieldValue(rowId, languageCode, nextValue) {
      const row = state.editorChapter.rows.find((entry) => entry.rowId === rowId);
      row.fields[languageCode] = nextValue;
      row.saveStatus = "dirty";
    },
    async persistEditorRowOnBlur(_render, rowId) {
      persistCount += 1;
      const row = state.editorChapter.rows.find((entry) => entry.rowId === rowId);
      row.persistedFields = { ...row.fields };
      row.saveStatus = "idle";
    },
  });

  assert.equal(persistCount, 1);
  assert.equal(state.editorChapter.rows[0].fields.vi, "Texto revisado");
  assert.equal(state.editorChapter.rows[0].persistedFields.vi, "Texto revisado");
  assert.equal(state.editorChapter.aiReview.status, "idle");
  assert.equal(
    invokeLog.some((entry) => entry.command === "run_ai_review"),
    false,
  );
});

test("AI key load and save flows populate and persist aiSettings state", async () => {
  resetSessionState();
  state.screen = "aiKey";
  state.aiSettings = {
    ...state.aiSettings,
    returnScreen: "teams",
  };

  let savedPayload = null;
  invokeHandler = async (command, payload = {}) => {
    if (command === "load_ai_provider_secret") {
      return "sk-existing";
    }
    if (command === "save_ai_provider_secret") {
      savedPayload = payload;
      return null;
    }

    throw new Error(`Unexpected command: ${command}`);
  };

  await loadAiProviderSecret(() => {});
  assert.equal(state.aiSettings.status, "ready");
  assert.equal(state.aiSettings.apiKey, "sk-existing");
  assert.equal(state.aiSettings.hasLoaded, true);

  updateAiProviderSecretDraft("  sk-updated  ");
  await saveAiProviderSecret(() => {});

  assert.deepEqual(savedPayload, {
    providerId: "openai",
    apiKey: "  sk-updated  ",
  });
  assert.equal(state.aiSettings.status, "ready");
  assert.equal(state.aiSettings.apiKey, "sk-updated");
});

test("AI review visibility suppresses stale suggestions and same-chapter UI keeps ai review state", () => {
  const visible = resolveVisibleEditorAiReview(
    {
      ...createEditorChapterState(),
      chapterId: "chapter-1",
      aiReview: {
        status: "ready",
        error: "",
        rowId: "row-1",
        languageCode: "vi",
        requestKey: "req-1",
        sourceText: "Texto original",
        suggestedText: "Texto revisado",
      },
    },
    "row-1",
    "vi",
    "Texto cambiado",
  );

  assert.equal(visible.showSuggestion, false);
  assert.equal(visible.isStale, true);
  assert.equal(visible.showReviewNow, true);

  const nextState = applyEditorUiState(
    {
      chapterId: "chapter-1",
      languages: [{ code: "vi" }],
      rows: [{ rowId: "row-1" }],
    },
    {
      ...createEditorChapterState(),
      chapterId: "chapter-1",
      activeRowId: "row-1",
      activeLanguageCode: "vi",
      reviewExpandedSectionKeys: new Set(["ai-review"]),
      aiReview: {
        status: "ready",
        error: "",
        rowId: "row-1",
        languageCode: "vi",
        requestKey: "req-2",
        sourceText: "Texto original",
        suggestedText: "Texto revisado",
      },
    },
  );

  assert.deepEqual([...nextState.reviewExpandedSectionKeys], ["ai-review"]);
  assert.equal(nextState.aiReview.status, "ready");
  assert.equal(nextState.aiReview.suggestedText, "Texto revisado");
});
