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
// runtime.js binds window.__TAURI__.core.invoke once at import time, so the
// mock delegates to a swappable handler tests can replace per case.
let invokeHandler = async () => null;
globalThis.window = {
  __TAURI__: {
    core: {
      invoke: (...args) => invokeHandler(...args),
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

function setupReviewRunProjectContext() {
  state.teams = [{ id: "team-1", installationId: 7, membershipRole: "owner" }];
  state.selectedTeamId = "team-1";
  state.projects = [{ id: "proj-1", name: "repo-1", chapters: [{ id: "chapter-1", title: "Chapter 1" }] }];
}

function reviewBatchChapter() {
  return chapter({
    rows: [
      row("row-a", { es: "Uno", vi: "Mot" }, { vi: { reviewed: false, pleaseCheck: false } }),
      row("row-b", { es: "Dos", vi: "Hai" }, { vi: { reviewed: false, pleaseCheck: false } }),
      row("row-c", { es: "Tres", vi: "Ba" }, { vi: { reviewed: false, pleaseCheck: false } }),
    ],
    aiReviewAllModal: {
      ...createEditorChapterState().aiReviewAllModal,
      isOpen: true,
      step: "configure",
      reviewMode: "grammar",
    },
  });
}

function reviewBatchOperations(overrides = {}) {
  return {
    updateEditorChapterRow: (rowId, updater) => {
      state.editorChapter = {
        ...state.editorChapter,
        rows: state.editorChapter.rows.map((candidate) =>
          candidate.rowId === rowId ? updater(candidate) : candidate),
      };
    },
    ensureAiReviewAllProviderReady: async () => ({ providerId: "openai", modelId: "gpt-5.5" }),
    ...overrides,
  };
}

test("AI Review All applies each batch response through one batched save, not per row", async () => {
  resetSessionState();
  editorAiReviewAllTestApi.resetActiveReviewAllRunId();
  setupReviewRunProjectContext();
  state.editorChapter = reviewBatchChapter();
  const invokedCommands = [];
  invokeHandler = async (command) => {
    invokedCommands.push(command);
    return null;
  };
  const applyBatchCalls = [];

  await confirmEditorAiReviewAll(() => {}, reviewBatchOperations({
    runAiReviewBatch: async (request) => ({
      rows: request.rows.map((requestRow) => ({
        rowId: requestRow.rowId,
        reviewed: requestRow.rowId === "row-b",
        suggestedText: requestRow.rowId === "row-b" ? "" : `fix:${requestRow.rowId}`,
      })),
    }),
    applyAiReviewResultsBatch: async (input) => {
      applyBatchCalls.push(input);
      return {
        languageCode: input.languageCode,
        rows: input.rows.map((inputRow) => ({
          rowId: inputRow.rowId,
          text: inputRow.reviewed
            ? state.editorChapter.rows.find((candidate) => candidate.rowId === inputRow.rowId).fields.vi
            : inputRow.suggestedText,
          footnote: "",
          imageCaption: "",
          reviewed: inputRow.reviewed,
          pleaseCheck: inputRow.pleaseCheck,
          lastUpdate: null,
        })),
        wordCounts: { vi: 42 },
        chapterBaseCommitSha: "abc1234",
      };
    },
  }));

  assert.equal(applyBatchCalls.length, 1);
  assert.equal(applyBatchCalls[0].installationId, 7);
  assert.equal(applyBatchCalls[0].projectId, "proj-1");
  assert.equal(applyBatchCalls[0].repoName, "repo-1");
  assert.equal(applyBatchCalls[0].chapterId, "chapter-1");
  assert.equal(applyBatchCalls[0].languageCode, "vi");
  assert.equal(applyBatchCalls[0].aiModel, "gpt-5.5");
  assert.deepEqual(applyBatchCalls[0].rows, [
    {
      rowId: "row-a",
      suggestedText: "fix:row-a",
      suggestedFootnote: "",
      suggestedImageCaption: "",
      reviewed: false,
      pleaseCheck: true,
    },
    {
      rowId: "row-b",
      suggestedText: "",
      suggestedFootnote: "",
      suggestedImageCaption: "",
      reviewed: true,
      pleaseCheck: false,
    },
    {
      rowId: "row-c",
      suggestedText: "fix:row-c",
      suggestedFootnote: "",
      suggestedImageCaption: "",
      reviewed: false,
      pleaseCheck: true,
    },
  ]);
  assert.equal(invokedCommands.includes("apply_gtms_editor_ai_review_result"), false);

  const rowsById = new Map(state.editorChapter.rows.map((candidate) => [candidate.rowId, candidate]));
  assert.equal(rowsById.get("row-a").fields.vi, "fix:row-a");
  assert.deepEqual(rowsById.get("row-a").fieldStates.vi, { reviewed: false, pleaseCheck: true });
  assert.equal(rowsById.get("row-b").fields.vi, "Hai");
  assert.deepEqual(rowsById.get("row-b").fieldStates.vi, { reviewed: true, pleaseCheck: false });
  assert.equal(rowsById.get("row-c").fields.vi, "fix:row-c");
  assert.deepEqual(state.editorChapter.wordCounts, { vi: 42 });
  assert.equal(state.editorChapter.chapterBaseCommitSha, "abc1234");
  assert.equal(state.editorChapter.aiReviewAllModal.step, "filter-enabled");
});

test("AI Review All rows missing from the batch response fall back to the single-row command", async () => {
  resetSessionState();
  editorAiReviewAllTestApi.resetActiveReviewAllRunId();
  setupReviewRunProjectContext();
  state.editorChapter = reviewBatchChapter();
  const singleApplyInputs = [];
  invokeHandler = async (command, args) => {
    if (command === "run_ai_review") {
      return { reviewed: false, suggestedText: "single:row-b" };
    }
    if (command === "apply_gtms_editor_ai_review_result") {
      singleApplyInputs.push(args.input);
      return {
        rowId: args.input.rowId,
        languageCode: args.input.languageCode,
        text: args.input.suggestedText,
        footnote: "",
        imageCaption: "",
        reviewed: args.input.reviewed,
        pleaseCheck: args.input.pleaseCheck,
        lastUpdate: null,
        chapterBaseCommitSha: "def5678",
      };
    }
    return null;
  };
  const applyBatchCalls = [];

  await confirmEditorAiReviewAll(() => {}, reviewBatchOperations({
    runAiReviewBatch: async (request) => ({
      rows: request.rows
        .filter((requestRow) => requestRow.rowId !== "row-b")
        .map((requestRow) => ({
          rowId: requestRow.rowId,
          reviewed: false,
          suggestedText: `fix:${requestRow.rowId}`,
        })),
    }),
    applyAiReviewResultsBatch: async (input) => {
      applyBatchCalls.push(input);
      return {
        languageCode: input.languageCode,
        rows: input.rows.map((inputRow) => ({
          rowId: inputRow.rowId,
          text: inputRow.suggestedText,
          footnote: "",
          imageCaption: "",
          reviewed: inputRow.reviewed,
          pleaseCheck: inputRow.pleaseCheck,
          lastUpdate: null,
        })),
        wordCounts: { vi: 40 },
        chapterBaseCommitSha: "abc1234",
      };
    },
  }));

  assert.equal(applyBatchCalls.length, 1);
  assert.deepEqual(
    applyBatchCalls[0].rows.map((inputRow) => inputRow.rowId),
    ["row-a", "row-c"],
  );
  assert.equal(singleApplyInputs.length, 1);
  assert.equal(singleApplyInputs[0].rowId, "row-b");
  assert.equal(singleApplyInputs[0].suggestedText, "single:row-b");
  assert.equal(singleApplyInputs[0].aiModel, "gpt-5.5");

  const rowsById = new Map(state.editorChapter.rows.map((candidate) => [candidate.rowId, candidate]));
  assert.equal(rowsById.get("row-a").fields.vi, "fix:row-a");
  assert.equal(rowsById.get("row-b").fields.vi, "single:row-b");
  assert.deepEqual(rowsById.get("row-b").fieldStates.vi, { reviewed: false, pleaseCheck: true });
  assert.equal(rowsById.get("row-c").fields.vi, "fix:row-c");
  assert.equal(state.editorChapter.aiReviewAllModal.step, "filter-enabled");
});
