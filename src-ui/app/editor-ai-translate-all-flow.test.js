import test from "node:test";
import assert from "node:assert/strict";

globalThis.document = {
  querySelector() {
    return null;
  },
  querySelectorAll() {
    return [];
  },
};
globalThis.window = {
  __TAURI__: {
    core: {
      invoke: async () => null,
    },
    event: {
      listen: async () => () => {},
    },
  },
  setTimeout(callback) {
    return 1;
  },
  clearTimeout() {},
};

const {
  cancelEditorAiTranslateAllModal,
  confirmEditorAiTranslateAll,
  editorAiTranslateAllTestApi,
} = await import("./editor-ai-translate-all-flow.js");
const {
  createEditorAiTranslateAllModalState,
  createEditorChapterState,
  resetSessionState,
  state,
} = await import("./state.js");

function chapter(overrides = {}) {
  return {
    ...createEditorChapterState(),
    chapterId: "chapter-1",
    selectedSourceLanguageCode: "es",
    languages: [
      { code: "es", name: "Spanish", role: "source" },
      { code: "vi", name: "Vietnamese", role: "target" },
      { code: "ja", name: "Japanese", role: "target" },
      { code: "fr", name: "French", role: "target" },
    ],
    rows: [
      {
        rowId: "row-1",
        lifecycleState: "active",
        fields: {
          es: "Hola",
          vi: "",
          ja: "",
          fr: "Bonjour",
        },
      },
      {
        rowId: "row-2",
        lifecycleState: "active",
        fields: {
          es: "",
          vi: "",
          ja: "",
          fr: "",
        },
      },
      {
        rowId: "row-3",
        lifecycleState: "active",
        fields: {
          es: "Adios",
          vi: "Tam biet",
          ja: "",
          fr: "",
        },
      },
      {
        rowId: "row-4",
        lifecycleState: "deleted",
        fields: {
          es: "Borrado",
          vi: "",
          ja: "",
          fr: "",
        },
      },
    ],
    ...overrides,
  };
}

test("AI Translate All target selection excludes source and collapsed languages", () => {
  const chapterState = chapter({
    collapsedLanguageCodes: new Set(["ja"]),
  });

  assert.deepEqual(
    editorAiTranslateAllTestApi.normalizeSelectedLanguageCodes(
      chapterState,
      ["es", "vi", "ja", "fr", "xx", "vi"],
    ),
    ["vi", "fr"],
  );
});

test("AI Translate All work includes only empty visible target fields with source text", () => {
  const chapterState = chapter({
    collapsedLanguageCodes: new Set(["ja"]),
  });

  assert.deepEqual(
    editorAiTranslateAllTestApi.buildEditorAiTranslateAllWork(
      chapterState,
      ["vi", "fr", "ja"],
    ),
    [
      {
        rowId: "row-1",
        sourceLanguageCode: "es",
        targetLanguageCode: "vi",
      },
      {
        rowId: "row-3",
        sourceLanguageCode: "es",
        targetLanguageCode: "fr",
      },
    ],
  );
});

test("stopping AI Translate All clears the active translation and closes the modal", () => {
  resetSessionState();
  editorAiTranslateAllTestApi.resetActiveBatchRunId();
  state.editorChapter = {
    ...chapter(),
    aiTranslateAllModal: {
      ...createEditorAiTranslateAllModalState(),
      isOpen: true,
      status: "loading",
      selectedLanguageCodes: ["vi"],
    },
    aiTranslate: {
      ...createEditorChapterState().aiTranslate,
      translate1: {
        status: "loading",
        error: "",
        rowId: "row-1",
        sourceLanguageCode: "es",
        targetLanguageCode: "vi",
        requestKey: "request-1",
        sourceText: "Hola",
      },
    },
  };
  const renderCalls = [];

  cancelEditorAiTranslateAllModal(() => {
    renderCalls.push("render");
  });

  assert.equal(state.editorChapter.aiTranslateAllModal.isOpen, false);
  assert.equal(state.editorChapter.aiTranslate.translate1.status, "idle");
  assert.equal(state.editorChapter.aiTranslate.translate1.requestKey, null);
  assert.equal(editorAiTranslateAllTestApi.getActiveBatchRunId(), 1);
  assert.equal(state.statusBadges.left.text, "AI translation stopped.");
  assert.equal(renderCalls.length >= 1, true);
});

test("AI Translate All updates modal progress after each completed language cell", async () => {
  resetSessionState();
  editorAiTranslateAllTestApi.resetActiveBatchRunId();
  state.editorChapter = {
    ...chapter(),
    aiTranslateAllModal: {
      ...createEditorAiTranslateAllModalState(),
      isOpen: true,
      selectedLanguageCodes: ["vi", "ja"],
    },
  };
  const renderCalls = [];

  await confirmEditorAiTranslateAll(
    (options) => {
      renderCalls.push(options ?? {});
    },
    {
      runEditorAiTranslateForContext: async (_render, _actionId, context) => {
        const row = state.editorChapter.rows.find((candidate) => candidate.rowId === context.rowId);
        row.fields[context.targetLanguageCode] = `${context.targetLanguageCode} translation`;
        if (context.rowId === "row-1" && context.targetLanguageCode === "vi") {
          row.fields.ja = "derived ja translation";
        }
        return { ok: true };
      },
    },
  );

  const modalRenderCalls = renderCalls.filter((call) =>
    call.scope === "translate-ai-translate-all-modal",
  );
  assert.equal(modalRenderCalls.length, 3);
  assert.equal(state.editorChapter.aiTranslateAllModal.isOpen, false);
  assert.equal(state.statusBadges.left.text, "AI translated 3 fields.");
});

test("AI Translate All progress state tracks selected languages independently", () => {
  const chapterState = chapter();
  const work = editorAiTranslateAllTestApi.buildEditorAiTranslateAllWork(chapterState, ["vi", "ja"]);
  const initialProgress =
    editorAiTranslateAllTestApi.buildEditorAiTranslateAllLanguageProgress(
      chapterState,
      ["vi", "ja"],
      work,
    );
  const nextProgress =
    editorAiTranslateAllTestApi.incrementEditorAiTranslateAllProgress(initialProgress, "ja");

  assert.deepEqual(initialProgress, {
    vi: { completedCount: 0, totalCount: 1 },
    ja: { completedCount: 0, totalCount: 2 },
  });
  assert.deepEqual(nextProgress, {
    vi: { completedCount: 0, totalCount: 1 },
    ja: { completedCount: 1, totalCount: 2 },
  });
});
