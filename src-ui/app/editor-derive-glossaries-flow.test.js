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
  editorDeriveGlossariesTestApi,
} = await import("./editor-derive-glossaries-flow.js");
const {
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
