import test from "node:test";
import assert from "node:assert/strict";

// runtime.js binds core.invoke at import time, so tests swap the handler
// rather than reassigning core.invoke.
let invokeHandler = async () => null;
globalThis.window = {
  __TAURI__: {
    core: {
      invoke: async (command, payload) => invokeHandler(command, payload),
    },
    event: {
      listen: async () => () => {},
    },
  },
  setTimeout() {
    return 1;
  },
  clearTimeout() {},
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
  confirmEditorDeriveGlossaries,
  editorDeriveGlossariesTestApi,
} = await import("./editor-derive-glossaries-flow.js");
const {
  buildDerivedGlossaryTermInputs,
  prepareEditorDerivedGlossaryForContext,
  resolveEditorDerivedGlossaryUsage,
} = await import("./editor-derived-glossary-flow.js");
const {
  buildEditorGlossaryRevisionKey,
} = await import("./editor-derived-glossary-state.js");
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
    ],
    ...overrides,
  };
  return {
    ...payload,
    matcherModel: buildEditorGlossaryModel(payload),
  };
}

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
      { code: "ja", name: "Japanese", role: "target" },
      { code: "fr", name: "French", role: "target" },
    ],
    glossary: glossary(),
    rows: [
      {
        rowId: "row-1",
        lifecycleState: "active",
        fields: {
          es: "Oracion",
          en: "",
          vi: "Cau nguyen",
          ja: "祈り",
          fr: "Priere",
        },
      },
      {
        rowId: "row-2",
        lifecycleState: "active",
        fields: {
          es: "Luz",
          en: "",
          vi: "",
          ja: "光",
          fr: "Lumiere",
        },
      },
      {
        rowId: "row-3",
        lifecycleState: "active",
        fields: {
          es: "Paz",
          en: "",
          vi: "Binh an",
          ja: "",
          fr: "Paix",
        },
      },
      {
        rowId: "row-4",
        lifecycleState: "deleted",
        fields: {
          es: "Borrado",
          en: "",
          vi: "Xoa",
          ja: "削除",
          fr: "Supprime",
        },
      },
    ],
    ...overrides,
  };
}

test("Derive glossaries config requires glossary languages and returns derivable file languages", () => {
  const config = editorDeriveGlossariesTestApi.resolveEditorDeriveGlossariesConfig(chapter());

  assert.equal(config.canDerive, true);
  assert.equal(config.glossarySourceLanguageCode, "en");
  assert.equal(config.glossaryTargetLanguageCode, "vi");
  assert.deepEqual(
    config.derivableLanguages.map((language) => language.code),
    ["es", "ja", "fr"],
  );
});

test("derived glossary term inputs split empty target variants into no-translation guidance", () => {
  const inputs = buildDerivedGlossaryTermInputs({
    terms: [
      {
        termId: "term-1",
        lifecycleState: "active",
        sourceTerms: ["mente"],
        targetTerms: ["", "tam", "tri"],
        targetVariantNotes: ["Omit when redundant.", "Preferred.", ""],
        notesToTranslators: "Use doctrinal sense.",
        footnote: "Footnote.",
      },
    ],
  });

  assert.deepEqual(inputs, [{
    glossarySourceTerms: ["mente"],
    targetVariants: [
      { text: "tam", note: "Preferred." },
      { text: "tri" },
    ],
    noTranslation: {
      position: "first",
      note: "Omit when redundant.",
    },
    notes: ["Use doctrinal sense."],
    globalNotes: ["Use doctrinal sense."],
    footnotes: ["Footnote."],
  }]);
});

test("Derive glossaries work skips deleted rows, missing target/editor source rows, and missing pair source only", () => {
  const chapterState = chapter();
  const config = editorDeriveGlossariesTestApi.resolveEditorDeriveGlossariesConfig(chapterState);
  const work = editorDeriveGlossariesTestApi.buildEditorDeriveGlossariesWork(
    chapterState,
    config.derivableLanguages,
  );

  assert.deepEqual(work, [
    { rowId: "row-1", sourceLanguageCode: "es", targetLanguageCode: "vi" },
    { rowId: "row-1", sourceLanguageCode: "ja", targetLanguageCode: "vi" },
    { rowId: "row-1", sourceLanguageCode: "fr", targetLanguageCode: "vi" },
    { rowId: "row-3", sourceLanguageCode: "es", targetLanguageCode: "vi" },
    { rowId: "row-3", sourceLanguageCode: "fr", targetLanguageCode: "vi" },
  ]);
});

test("Derive glossaries work skips row-language pairs with a fresh derived glossary cache", () => {
  const chapterState = chapter();
  chapterState.rows[0] = {
    ...chapterState.rows[0],
    fields: {
      ...chapterState.rows[0].fields,
      en: "prayer",
    },
  };
  chapterState.derivedGlossariesByRowId = {
    "row-1": {
      status: "ready",
      error: "",
      requestKey: "request-1",
      translationSourceLanguageCode: "ja",
      glossarySourceLanguageCode: "en",
      targetLanguageCode: "vi",
      translationSourceText: "祈り",
      glossarySourceText: "prayer",
      glossarySourceTextOrigin: "row",
      glossaryRevisionKey: buildEditorGlossaryRevisionKey(chapterState.glossary),
      entries: [
        {
          sourceTerm: "祈り",
          glossarySourceTerm: "prayer",
          targetVariants: ["cau nguyen"],
          notes: [],
        },
      ],
      matcherModel: null,
    },
  };
  const config = editorDeriveGlossariesTestApi.resolveEditorDeriveGlossariesConfig(chapterState);
  const work = editorDeriveGlossariesTestApi.buildEditorDeriveGlossariesWork(
    chapterState,
    config.derivableLanguages,
  );

  assert.deepEqual(work, [
    { rowId: "row-1", sourceLanguageCode: "es", targetLanguageCode: "vi" },
    { rowId: "row-1", sourceLanguageCode: "fr", targetLanguageCode: "vi" },
    { rowId: "row-3", sourceLanguageCode: "es", targetLanguageCode: "vi" },
    { rowId: "row-3", sourceLanguageCode: "fr", targetLanguageCode: "vi" },
  ]);
});

test("Derive glossaries work keeps stale derived glossary cache items eligible", () => {
  const chapterState = chapter();
  chapterState.rows[0] = {
    ...chapterState.rows[0],
    fields: {
      ...chapterState.rows[0].fields,
      en: "prayer",
    },
  };
  chapterState.derivedGlossariesByRowId = {
    "row-1": {
      status: "ready",
      error: "",
      requestKey: "request-1",
      translationSourceLanguageCode: "ja",
      glossarySourceLanguageCode: "en",
      targetLanguageCode: "vi",
      translationSourceText: "古い祈り",
      glossarySourceText: "prayer",
      glossarySourceTextOrigin: "row",
      glossaryRevisionKey: buildEditorGlossaryRevisionKey(chapterState.glossary),
      entries: [],
      matcherModel: null,
    },
  };

  assert.equal(
    editorDeriveGlossariesTestApi.editorDeriveGlossaryWorkItemHasFreshCache(
      chapterState,
      { rowId: "row-1", sourceLanguageCode: "ja", targetLanguageCode: "vi" },
    ),
    false,
  );
});

function seedDeriveRunEnvironment() {
  resetSessionState();
  // No team selected: the shared AI configuration load is skipped and the
  // provider-key check takes the local-secret path.
  invokeHandler = async (command) =>
    command === "load_ai_provider_secret" ? "sk-test" : null;
  state.aiSettings = {
    ...state.aiSettings,
    actionConfig: {
      ...state.aiSettings.actionConfig,
      detailedConfiguration: false,
      unified: { providerId: "openai", modelId: "test-model" },
    },
  };
  state.editorChapter = chapter();
}

function deriveRunOperations(overrides = {}) {
  return {
    updateEditorRowFieldValue: (rowId, languageCode, nextValue) => {
      state.editorChapter = {
        ...state.editorChapter,
        rows: state.editorChapter.rows.map((candidate) =>
          candidate.rowId === rowId
            ? {
              ...candidate,
              fields: { ...candidate.fields, [languageCode]: nextValue },
            }
            : candidate,
        ),
      };
    },
    persistEditorRowOnBlur: async () => {},
    ...overrides,
  };
}

test("Derive glossaries batches generation and derivation per language pair", async () => {
  seedDeriveRunEnvironment();
  const generationCalls = [];
  const prepareCalls = [];

  await confirmEditorDeriveGlossaries(
    () => {},
    deriveRunOperations({
      runAiTranslationBatch: async (request) => {
        generationCalls.push(request);
        return {
          rows: request.rows.map((row) => ({
            rowId: row.rowId,
            translatedText: `en:${row.sourceText}`,
          })),
        };
      },
      prepareEditorAiTranslatedGlossaryBatch: async (request) => {
        prepareCalls.push(request);
        return { glossarySourceText: request.glossarySourceText, entries: [] };
      },
    }),
  );

  // The pivot (en) column was empty, so the first language-pair group makes
  // ONE batched generation call; later groups reuse the freshly written texts.
  assert.equal(generationCalls.length, 1);
  assert.equal(generationCalls[0].targetLanguageCode, "en");
  assert.deepEqual(
    generationCalls[0].rows.map((row) => row.sourceText),
    ["Oracion", "Paz"],
  );
  assert.equal(
    state.editorChapter.rows.find((row) => row.rowId === "row-1").fields.en,
    "en:Oracion",
  );
  assert.equal(
    state.editorChapter.rows.find((row) => row.rowId === "row-3").fields.en,
    "en:Paz",
  );
  // One combined derivation call per language pair (es, ja, fr -> vi), not one
  // per work item.
  assert.deepEqual(
    prepareCalls.map((request) => request.translationSourceTexts),
    [["Oracion", "Paz"], ["祈り"], ["Priere", "Paix"]],
  );
  assert.equal(state.editorChapter.deriveGlossariesModal.isOpen, false);
  assert.equal(state.statusBadges.left.text, "Derived 5 glossaries.");
  assert.equal(state.editorChapter.derivedGlossariesByRowId["row-1"].status, "ready");
  assert.equal(state.editorChapter.derivedGlossariesByRowId["row-3"].status, "ready");
});

test("Derive glossaries explicitly syncs the glossary highlight DOM for each derived row", async () => {
  seedDeriveRunEnvironment();
  const syncedRowIds = [];
  const rowScopedRenders = [];

  await confirmEditorDeriveGlossaries(
    (options) => {
      if (options?.scope === "translate-visible-rows") {
        rowScopedRenders.push(options.rowIds);
      }
    },
    deriveRunOperations({
      runAiTranslationBatch: async (request) => ({
        rows: request.rows.map((row) => ({ rowId: row.rowId, translatedText: `en:${row.sourceText}` })),
      }),
      prepareEditorAiTranslatedGlossaryBatch: async (request) => ({
        glossarySourceText: request.glossarySourceText,
        entries: [],
      }),
      syncEditorGlossaryHighlightRowDom: (rowId) => {
        syncedRowIds.push(rowId);
      },
    }),
  );

  // Every derived row gets an explicit DOM sync call, not just a scoped
  // render — this is the same mechanism the single-row translate path relies
  // on, and it must not silently no-op here the way it did before this fix
  // (operations.syncEditorGlossaryHighlightRowDom was never wired in, so this
  // call — already present in the code — was always undefined and skipped).
  assert.equal(syncedRowIds.includes("row-1"), true);
  assert.equal(syncedRowIds.includes("row-3"), true);
  assert.equal(rowScopedRenders.flat().includes("row-1"), true);
  assert.equal(rowScopedRenders.flat().includes("row-3"), true);
});

test("Derive glossaries falls back to the single-row path when batch derivation fails", async () => {
  seedDeriveRunEnvironment();
  const fallbackItems = [];

  await confirmEditorDeriveGlossaries(
    () => {},
    deriveRunOperations({
      runAiTranslationBatch: async (request) => ({
        rows: request.rows.map((row) => ({
          rowId: row.rowId,
          translatedText: `en:${row.sourceText}`,
        })),
      }),
      prepareEditorAiTranslatedGlossaryBatch: async () => {
        throw new Error("provider error");
      },
      prepareEditorDerivedGlossaryForContext: async ({ context }) => {
        fallbackItems.push([context.rowId, context.sourceLanguageCode]);
        return { ok: true };
      },
    }),
  );

  // Every work item retried through the single-row path, in group order.
  assert.deepEqual(fallbackItems, [
    ["row-1", "es"],
    ["row-3", "es"],
    ["row-1", "ja"],
    ["row-1", "fr"],
    ["row-3", "fr"],
  ]);
  assert.equal(state.editorChapter.deriveGlossariesModal.isOpen, false);
  assert.equal(state.statusBadges.left.text, "Derived 5 glossaries.");
});

test("Derive glossaries surfaces a single-row fallback error in the modal and stops", async () => {
  seedDeriveRunEnvironment();

  await confirmEditorDeriveGlossaries(
    () => {},
    deriveRunOperations({
      runAiTranslationBatch: async (request) => ({
        rows: request.rows.map((row) => ({
          rowId: row.rowId,
          translatedText: `en:${row.sourceText}`,
        })),
      }),
      prepareEditorAiTranslatedGlossaryBatch: async () => {
        throw new Error("provider error");
      },
      prepareEditorDerivedGlossaryForContext: async () => {
        throw new Error("row failed");
      },
    }),
  );

  assert.equal(state.editorChapter.deriveGlossariesModal.isOpen, true);
  assert.equal(state.editorChapter.deriveGlossariesModal.status, "idle");
  assert.equal(state.editorChapter.deriveGlossariesModal.error, "row failed");
});

test("Derived glossary preparation saves generated glossary source text before building the entry", async () => {
  resetSessionState();
  state.editorChapter = chapter();
  const row = state.editorChapter.rows[0];
  const context = {
    chapterState: state.editorChapter,
    projectId: state.editorChapter.projectId,
    row,
    chapterId: state.editorChapter.chapterId,
    rowId: row.rowId,
    sourceLanguageCode: "ja",
    targetLanguageCode: "vi",
    sourceLanguage: { code: "ja", name: "Japanese" },
    targetLanguage: { code: "vi", name: "Vietnamese" },
    sourceLanguageLabel: "Japanese",
    targetLanguageLabel: "Vietnamese",
    sourceText: "祈り",
  };
  const glossaryUsage = resolveEditorDerivedGlossaryUsage(context, {
    useCurrentGlossarySourceText: true,
  });
  const rowUpdates = [];
  const persistCalls = [];
  const invokeCalls = [];

  const result = await prepareEditorDerivedGlossaryForContext({
    context,
    glossaryUsage,
    providerId: "openai",
    modelId: "test-model",
    requestKey: "request-1",
    persistGlossarySourceImmediately: true,
    generateMissingGlossarySourceTextWhenMissing: true,
    generationSourceText: "Oracion",
    generationSourceLanguageLabel: "Spanish",
    updateEditorRowFieldValue(rowId, languageCode, nextValue) {
      rowUpdates.push([rowId, languageCode, nextValue]);
      state.editorChapter = {
        ...state.editorChapter,
        rows: state.editorChapter.rows.map((candidate) =>
          candidate.rowId === rowId
            ? {
              ...candidate,
              fields: {
                ...candidate.fields,
                [languageCode]: nextValue,
              },
            }
            : candidate,
        ),
      };
    },
    persistEditorRowOnBlur(_render, rowId) {
      persistCalls.push(rowId);
    },
    operations: {
      async invoke(command, payload) {
        invokeCalls.push([command, payload]);
        if (command === "run_ai_translation") {
          return { translatedText: "prayer" };
        }
        return {
          entries: [
            {
              sourceTerms: ["祈り"],
              targetTerms: ["cau nguyen"],
            },
          ],
        };
      },
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(rowUpdates, [["row-1", "en", "prayer"]]);
  assert.deepEqual(persistCalls, ["row-1"]);
  assert.equal(invokeCalls[0][0], "run_ai_translation");
  assert.equal(invokeCalls[1][0], "prepare_editor_ai_translated_glossary");
  assert.equal(result.derivedEntry.glossarySourceText, "prayer");
  assert.equal(state.editorChapter.derivedGlossariesByRowId["row-1"].status, "ready");
});
