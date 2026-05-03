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
  editorAiReviewAllTestApi,
  openEditorAiReviewAllModal,
  updateEditorAiReviewAllMode,
} = await import("./editor-ai-review-all-flow.js");
const {
  createEditorChapterState,
  resetSessionState,
  state,
} = await import("./state.js");

function row(rowId, fields, fieldStates = {}, lifecycleState = "active") {
  return {
    rowId,
    lifecycleState,
    fields,
    fieldStates,
  };
}

function chapter(overrides = {}) {
  return {
    ...createEditorChapterState(),
    chapterId: "chapter-1",
    selectedSourceLanguageCode: "es",
    selectedTargetLanguageCode: "vi",
    languages: [
      { code: "es", name: "Spanish", role: "source" },
      { code: "vi", name: "Vietnamese", role: "target" },
    ],
    rows: [
      row("row-1", { es: "Uno", vi: "Mot" }, { vi: { reviewed: false, pleaseCheck: false } }),
      row("row-2", { es: "Dos", vi: "Hai" }, { vi: { reviewed: true, pleaseCheck: false } }),
      row("row-3", { es: "Tres", vi: "" }, { vi: { reviewed: false, pleaseCheck: false } }),
      row("row-4", { es: "Cuatro", vi: "Bon" }, { vi: { reviewed: false, pleaseCheck: false } }, "deleted"),
      row("row-5", { es: "Cinco", vi: "Nam" }, { vi: { reviewed: false, pleaseCheck: true } }),
    ],
    ...overrides,
  };
}

test("AI Review All work skips reviewed, empty, and deleted translations", () => {
  const chapterState = chapter();

  assert.deepEqual(
    editorAiReviewAllTestApi.buildEditorAiReviewAllWork(chapterState),
    [
      { rowId: "row-1", languageCode: "vi" },
      { rowId: "row-5", languageCode: "vi" },
    ],
  );
  assert.deepEqual(
    editorAiReviewAllTestApi.buildEditorAiReviewAllCounts(chapterState),
    {
      languageCode: "vi",
      reviewedCount: 1,
      totalTranslationCount: 3,
      totalCount: 2,
    },
  );
});

test("AI Review All opens preflight when reviewed translations exist", () => {
  resetSessionState();
  state.editorChapter = chapter();

  openEditorAiReviewAllModal(() => {});

  assert.equal(state.editorChapter.aiReviewAllModal.isOpen, true);
  assert.equal(state.editorChapter.aiReviewAllModal.step, "preflight");
  assert.equal(state.editorChapter.aiReviewAllModal.languageCode, "vi");
  assert.equal(state.editorChapter.aiReviewAllModal.reviewedCount, 1);
  assert.equal(state.editorChapter.aiReviewAllModal.totalTranslationCount, 3);
});

test("AI Review All mode update is exclusive and normalizes unknown values", () => {
  resetSessionState();
  state.editorChapter = chapter({
    aiReviewAllModal: {
      ...createEditorChapterState().aiReviewAllModal,
      isOpen: true,
      step: "configure",
      reviewMode: "grammar",
    },
  });

  updateEditorAiReviewAllMode(() => {}, "meaning");
  assert.equal(state.editorChapter.aiReviewAllModal.reviewMode, "meaning");

  updateEditorAiReviewAllMode(() => {}, "anything");
  assert.equal(state.editorChapter.aiReviewAllModal.reviewMode, "grammar");
});
