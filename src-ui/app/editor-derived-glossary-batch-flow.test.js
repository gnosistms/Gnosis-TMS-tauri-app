import test from "node:test";
import assert from "node:assert/strict";

globalThis.window = {
  __TAURI__: {
    core: {
      invoke: async () => null,
    },
    event: {
      listen: async () => () => {},
    },
  },
};
globalThis.document = {
  querySelector() {
    return null;
  },
  querySelectorAll() {
    return [];
  },
};

const {
  editorDerivedGlossaryBatchTestApi,
  ensureBatchDerivedGlossaries,
} = await import("./editor-derived-glossary-batch-flow.js");
const {
  buildEditorGlossaryModel,
} = await import("./editor-glossary-highlighting.js");
const {
  createEditorChapterState,
  resetSessionState,
  state,
} = await import("./state.js");

function glossary(overrides = {}) {
  const payload = {
    glossaryId: "glossary-1",
    repoName: "team/glossary",
    title: "Base glossary",
    sourceLanguage: { code: "en", name: "English" },
    targetLanguage: { code: "vi", name: "Vietnamese" },
    terms: [
      {
        termId: "term-1",
        lifecycleState: "active",
        sourceTerms: ["prayer"],
        targetTerms: ["cau nguyen"],
      },
      {
        termId: "term-2",
        lifecycleState: "active",
        sourceTerms: ["light"],
        targetTerms: ["anh sang"],
      },
    ],
    ...overrides,
  };
  return {
    ...payload,
    matcherModel: buildEditorGlossaryModel(payload),
  };
}

// Chapter source es, glossary en -> vi: translating es -> vi uses a derived
// glossary pivoting through the en column.
function chapter(overrides = {}) {
  return {
    ...createEditorChapterState(),
    chapterId: "chapter-1",
    projectId: "project-1",
    selectedSourceLanguageCode: "es",
    languages: [
      { code: "es", name: "Spanish", role: "source" },
      { code: "en", name: "English", role: "target" },
      { code: "vi", name: "Vietnamese", role: "target" },
    ],
    glossary: glossary(),
    rows: [
      { rowId: "row-1", lifecycleState: "active", fields: { es: "Oracion santa", en: "holy prayer", vi: "" } },
      { rowId: "row-2", lifecycleState: "active", fields: { es: "Luz clara", en: "clear light", vi: "" } },
      { rowId: "row-3", lifecycleState: "active", fields: { es: "Paz", en: "", vi: "" } },
    ],
    ...overrides,
  };
}

function items(chapterState) {
  return chapterState.rows.map((row) => ({
    rowId: row.rowId,
    sourceLanguageCode: "es",
    targetLanguageCode: "vi",
  }));
}

test("ensureBatchDerivedGlossaries derives once per chunk and redistributes entries per row", async () => {
  resetSessionState();
  state.editorChapter = chapter();
  const prepareCalls = [];

  const { aborted, results } = await ensureBatchDerivedGlossaries({
    chapterState: state.editorChapter,
    items: items(state.editorChapter).slice(0, 2),
    providerId: "openai",
    modelId: "test-model",
    operations: {
      prepareEditorAiTranslatedGlossaryBatch: async (request) => {
        prepareCalls.push(request);
        return {
          glossarySourceText: request.glossarySourceText,
          entries: [
            { sourceTerm: "Oracion", glossarySourceTerm: "prayer", targetVariants: ["cau nguyen"] },
            { sourceTerm: "Luz", glossarySourceTerm: "light", targetVariants: ["anh sang"] },
          ],
        };
      },
    },
  });

  assert.equal(aborted, false);
  assert.equal(prepareCalls.length, 1);
  assert.deepEqual(prepareCalls[0].translationSourceTexts, ["Oracion santa", "Luz clara"]);
  assert.equal(prepareCalls[0].glossarySourceText, "holy prayer\n\nclear light");
  assert.equal(prepareCalls[0].glossarySourceLanguage, "English");
  assert.deepEqual(results.map((result) => result.status), ["derived", "derived"]);
  // Each row keeps only the entries contained in its own source text.
  const entriesByRow = state.editorChapter.derivedGlossariesByRowId;
  assert.equal(entriesByRow["row-1"].status, "ready");
  assert.deepEqual(entriesByRow["row-1"].entries.map((entry) => entry.sourceTerm), ["Oracion"]);
  assert.deepEqual(entriesByRow["row-2"].entries.map((entry) => entry.sourceTerm), ["Luz"]);
});

test("ensureBatchDerivedGlossaries reuses fresh cached entries and reports rows missing pivot text", async () => {
  resetSessionState();
  state.editorChapter = chapter();
  // row-1 gets a fresh cached entry (matching current texts + revision key).
  const { buildEditorGlossaryRevisionKey } = await import("./editor-derived-glossary-state.js");
  state.editorChapter.derivedGlossariesByRowId = {
    "row-1": {
      status: "ready",
      error: "",
      requestKey: "request-1",
      translationSourceLanguageCode: "es",
      glossarySourceLanguageCode: "en",
      targetLanguageCode: "vi",
      translationSourceText: "Oracion santa",
      glossarySourceText: "holy prayer",
      glossarySourceTextOrigin: "row",
      glossaryRevisionKey: buildEditorGlossaryRevisionKey(state.editorChapter.glossary),
      entries: [{ sourceTerm: "Oracion", glossarySourceTerm: "prayer", targetVariants: ["cau nguyen"] }],
      matcherModel: null,
    },
  };
  const prepareCalls = [];

  const { results } = await ensureBatchDerivedGlossaries({
    chapterState: state.editorChapter,
    items: items(state.editorChapter),
    providerId: "openai",
    modelId: "test-model",
    operations: {
      prepareEditorAiTranslatedGlossaryBatch: async (request) => {
        prepareCalls.push(request);
        return { glossarySourceText: request.glossarySourceText, entries: [] };
      },
    },
  });

  // row-1 cached, row-2 derived, row-3 (empty en column) unresolved.
  assert.deepEqual(
    results.map((result) => [result.item.rowId, result.status, result.reason ?? null]),
    [
      ["row-1", "cached", null],
      ["row-3", "unresolved", "missing-pivot-text"],
      ["row-2", "derived", null],
    ],
  );
  assert.equal(prepareCalls.length, 1);
  assert.deepEqual(prepareCalls[0].translationSourceTexts, ["Luz clara"]);
});

test("ensureBatchDerivedGlossaries resolves a failed chunk as unresolved and continues", async () => {
  resetSessionState();
  state.editorChapter = chapter();

  const { aborted, results } = await ensureBatchDerivedGlossaries({
    chapterState: state.editorChapter,
    items: items(state.editorChapter).slice(0, 2),
    providerId: "openai",
    modelId: "test-model",
    chunkOptions: { maxRows: 1 },
    operations: {
      prepareEditorAiTranslatedGlossaryBatch: async (request) => {
        if (request.translationSourceTexts[0] === "Oracion santa") {
          throw new Error("provider error");
        }
        return {
          glossarySourceText: request.glossarySourceText,
          entries: [{ sourceTerm: "Luz", glossarySourceTerm: "light", targetVariants: ["anh sang"] }],
        };
      },
    },
  });

  assert.equal(aborted, false);
  assert.deepEqual(
    results.map((result) => [result.item.rowId, result.status, result.reason ?? null]),
    [
      ["row-1", "unresolved", "derivation-failed"],
      ["row-2", "derived", null],
    ],
  );
  assert.equal(state.editorChapter.derivedGlossariesByRowId?.["row-1"], undefined);
  assert.equal(state.editorChapter.derivedGlossariesByRowId?.["row-2"]?.status, "ready");
});

test("ensureBatchDerivedGlossaries skips applying entries when the source changed mid-flight", async () => {
  resetSessionState();
  state.editorChapter = chapter();

  const { results } = await ensureBatchDerivedGlossaries({
    chapterState: state.editorChapter,
    items: items(state.editorChapter).slice(0, 2),
    providerId: "openai",
    modelId: "test-model",
    operations: {
      prepareEditorAiTranslatedGlossaryBatch: async (request) => {
        // Simulate the user editing row-1's source while the batch is in flight.
        state.editorChapter = {
          ...state.editorChapter,
          rows: state.editorChapter.rows.map((row) =>
            row.rowId === "row-1"
              ? { ...row, fields: { ...row.fields, es: "Oracion editada" } }
              : row,
          ),
        };
        return { glossarySourceText: request.glossarySourceText, entries: [] };
      },
    },
  });

  assert.deepEqual(
    results.map((result) => [result.item.rowId, result.status, result.reason ?? null]),
    [
      ["row-1", "unresolved", "stale-source"],
      ["row-2", "derived", null],
    ],
  );
  assert.equal(state.editorChapter.derivedGlossariesByRowId?.["row-1"], undefined);
});

test("ensureBatchDerivedGlossaries aborts without writes when the run goes inactive", async () => {
  resetSessionState();
  state.editorChapter = chapter();
  let active = true;

  const { aborted, results } = await ensureBatchDerivedGlossaries({
    chapterState: state.editorChapter,
    items: items(state.editorChapter).slice(0, 2),
    providerId: "openai",
    modelId: "test-model",
    isRunActive: () => active,
    operations: {
      prepareEditorAiTranslatedGlossaryBatch: async (request) => {
        active = false;
        return { glossarySourceText: request.glossarySourceText, entries: [] };
      },
    },
  });

  assert.equal(aborted, true);
  assert.deepEqual(results, []);
  assert.deepEqual(state.editorChapter.derivedGlossariesByRowId ?? {}, {});
});

test("ensureBatchDerivedGlossaries reports none for rows whose glossary usage is not derived", async () => {
  resetSessionState();
  // Glossary source matches the translation source (es) => direct, not derived.
  state.editorChapter = chapter({
    glossary: glossary({ sourceLanguage: { code: "es", name: "Spanish" } }),
  });

  const { results } = await ensureBatchDerivedGlossaries({
    chapterState: state.editorChapter,
    items: items(state.editorChapter),
    providerId: "openai",
    modelId: "test-model",
    operations: {
      prepareEditorAiTranslatedGlossaryBatch: async () => {
        throw new Error("should not be called");
      },
    },
  });

  assert.deepEqual(results.map((result) => result.status), ["none", "none", "none"]);
});

test("chunkPendingDerivations bounds chunks by row count and combined token budget", () => {
  const pendingFor = (sourceText, pivotText) => ({
    context: { sourceText },
    usage: { preparationGlossarySourceText: pivotText },
  });

  const byRows = editorDerivedGlossaryBatchTestApi.chunkPendingDerivations(
    [pendingFor("a", "b"), pendingFor("c", "d"), pendingFor("e", "f")],
    { maxRows: 2 },
  );
  assert.deepEqual(byRows.map((chunk) => chunk.length), [2, 1]);

  // ~25 tokens of source + ~25 of pivot per item (100 chars / 4) => two items
  // exceed a 60-token target, so each lands in its own chunk.
  const longText = "x".repeat(100);
  const byTokens = editorDerivedGlossaryBatchTestApi.chunkPendingDerivations(
    [pendingFor(longText, longText), pendingFor(longText, longText)],
    { tokenTarget: 60 },
  );
  assert.deepEqual(byTokens.map((chunk) => chunk.length), [1, 1]);
});

test("buildDerivedGlossaryItemContext resolves the target language by base code", () => {
  const chapterState = chapter({
    languages: [
      { code: "es", name: "Spanish", role: "source" },
      { code: "en", name: "English", role: "target" },
      { code: "vi-x-alt", name: "Vietnamese Alt", role: "target", baseCode: "vi" },
    ],
  });

  const context = editorDerivedGlossaryBatchTestApi.buildDerivedGlossaryItemContext(
    chapterState,
    { rowId: "row-1", sourceLanguageCode: "es", targetLanguageCode: "vi" },
  );

  assert.equal(context.targetLanguage.code, "vi-x-alt");
  assert.equal(context.sourceText, "Oracion santa");
});
