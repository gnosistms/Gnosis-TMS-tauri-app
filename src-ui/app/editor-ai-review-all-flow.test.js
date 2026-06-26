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
  confirmEditorAiReviewAll,
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
    persistedFields: { ...fields },
    fieldStates,
    persistedFieldStates: { ...fieldStates },
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

test("AI Review All work includes footnote-only and caption-only rows", () => {
  const chapterState = chapter();
  chapterState.rows[2].footnotes = {
    vi: "Chu thich can review",
  };
  chapterState.rows.push({
    ...row("row-6", { es: "Seis", vi: "" }, { vi: { reviewed: false, pleaseCheck: false } }),
    imageCaptions: {
      vi: "Caption needs review",
    },
  });

  assert.deepEqual(
    editorAiReviewAllTestApi.buildEditorAiReviewAllWork(chapterState),
    [
      { rowId: "row-1", languageCode: "vi" },
      { rowId: "row-3", languageCode: "vi" },
      { rowId: "row-5", languageCode: "vi" },
      { rowId: "row-6", languageCode: "vi" },
    ],
  );
  assert.deepEqual(
    editorAiReviewAllTestApi.buildEditorAiReviewAllCounts(chapterState),
    {
      languageCode: "vi",
      reviewedCount: 1,
      totalTranslationCount: 5,
      totalCount: 4,
    },
  );
});


test("AI Review All does not create an empty footnote on rows without one", () => {
  const reviewedRow = row("row-1", { es: "Uno", vi: "Mot" }, { vi: { reviewed: false, pleaseCheck: false } });

  const result = editorAiReviewAllTestApi.applyReviewResultToRow(reviewedRow, "vi", {
    text: "Mot sua",
    footnote: "",
    imageCaption: "",
    reviewed: false,
    pleaseCheck: true,
  });

  assert.equal(result.footnotes.vi, undefined);
  assert.equal(result.persistedFootnotes.vi, undefined);
  assert.equal(result.fields.vi, "Mot sua");
});

test("AI Review All applies a non-empty footnote suggestion", () => {
  const reviewedRow = row("row-1", { es: "Uno", vi: "Mot" }, { vi: { reviewed: false, pleaseCheck: false } });

  const result = editorAiReviewAllTestApi.applyReviewResultToRow(reviewedRow, "vi", {
    text: "Mot sua",
    footnote: "Ghi chu",
    imageCaption: "",
    reviewed: false,
    pleaseCheck: true,
  });

  assert.deepEqual(result.footnotes.vi, [{ marker: 1, text: "Ghi chu" }]);
  assert.deepEqual(result.persistedFootnotes.vi, [{ marker: 1, text: "Ghi chu" }]);
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

test("AI Review All enters preparing review state before startup checks finish", async () => {
  resetSessionState();
  state.editorChapter = chapter({
    aiReviewAllModal: {
      ...createEditorChapterState().aiReviewAllModal,
      isOpen: true,
      step: "configure",
      reviewMode: "meaning",
    },
    rows: [
      { ...row("row-1", { es: "Uno", vi: "Mot" }, { vi: { reviewed: false, pleaseCheck: false } }), freshness: "stale" },
      row("row-2", { es: "Dos", vi: "Hai" }, { vi: { reviewed: false, pleaseCheck: false } }),
    ],
  });
  let renderCount = 0;

  const run = confirmEditorAiReviewAll(() => {
    renderCount += 1;
  });

  assert.equal(state.editorChapter.aiReviewAllModal.step, "reviewing");
  assert.equal(state.editorChapter.aiReviewAllModal.status, "preparing");
  assert.equal(state.editorChapter.aiReviewAllModal.reviewMode, "meaning");
  assert.equal(state.editorChapter.aiReviewAllModal.completedCount, 0);
  assert.equal(state.editorChapter.aiReviewAllModal.totalCount, 2);
  assert.deepEqual(state.editorChapter.aiReviewAllModal.languageProgress, {
    vi: { completedCount: 0, totalCount: 2 },
  });
  assert.equal(renderCount, 1);

  await run;

  assert.equal(state.editorChapter.aiReviewAllModal.step, "configure");
  assert.equal(state.editorChapter.aiReviewAllModal.status, "idle");
  assert.equal(state.editorChapter.aiReviewAllModal.error, "Refresh or resolve the file before running AI Review.");
});
