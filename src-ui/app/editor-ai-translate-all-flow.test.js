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

test("AI Translate All target selection excludes duplicate columns with the source base language", () => {
  const chapterState = chapter({
    languages: [
      { code: "es", name: "Spanish 1", role: "source", baseCode: "es" },
      { code: "es-x-2", name: "Spanish 2", role: "target", baseCode: "es" },
      { code: "vi", name: "Vietnamese", role: "target" },
    ],
  });

  assert.deepEqual(
    editorAiTranslateAllTestApi.visibleTargetLanguagesForChapter(chapterState)
      .map((language) => language.code),
    ["vi"],
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

test("AI Translate All work includes footnote-only and caption-only rows", () => {
  const chapterState = chapter();
  chapterState.rows[1].footnotes = {
    es: "Nota fuente",
    vi: "",
  };
  chapterState.rows[2].imageCaptions = {
    es: "Caption source",
    vi: "",
    fr: "Caption francaise",
  };

  assert.deepEqual(
    editorAiTranslateAllTestApi.buildEditorAiTranslateAllWork(
      chapterState,
      ["vi"],
    ),
    [
      {
        rowId: "row-1",
        sourceLanguageCode: "es",
        targetLanguageCode: "vi",
      },
      {
        rowId: "row-2",
        sourceLanguageCode: "es",
        targetLanguageCode: "vi",
      },
      {
        rowId: "row-3",
        sourceLanguageCode: "es",
        targetLanguageCode: "vi",
      },
    ],
  );
});

test("AI Translate All translates the glossary source language first when it is selected", () => {
  const chapterState = chapter({
    languages: [
      { code: "es", name: "Spanish", role: "source" },
      { code: "en", name: "English", role: "target" },
      { code: "ja", name: "Japanese", role: "target" },
    ],
    glossary: {
      sourceLanguage: { code: "en", name: "English" },
      targetLanguage: { code: "ja", name: "Japanese" },
      matcherModel: null,
    },
    rows: [
      {
        rowId: "row-1",
        lifecycleState: "active",
        fields: {
          es: "Hola",
          en: "",
          ja: "",
        },
      },
      {
        rowId: "row-2",
        lifecycleState: "active",
        fields: {
          es: "Adios",
          en: "",
          ja: "",
        },
      },
    ],
  });

  assert.deepEqual(
    editorAiTranslateAllTestApi.buildEditorAiTranslateAllWork(
      chapterState,
      ["ja", "en"],
    ),
    [
      {
        rowId: "row-1",
        sourceLanguageCode: "es",
        targetLanguageCode: "en",
      },
      {
        rowId: "row-1",
        sourceLanguageCode: "es",
        targetLanguageCode: "ja",
      },
      {
        rowId: "row-2",
        sourceLanguageCode: "es",
        targetLanguageCode: "en",
      },
      {
        rowId: "row-2",
        sourceLanguageCode: "es",
        targetLanguageCode: "ja",
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

function batchChapter() {
  return {
    ...createEditorChapterState(),
    chapterId: "chapter-1",
    selectedSourceLanguageCode: "es",
    languages: [
      { code: "es", name: "Spanish", role: "source" },
      { code: "vi", name: "Vietnamese", role: "target" },
    ],
    rows: [
      { rowId: "row-a", lifecycleState: "active", fields: { es: "Hola", vi: "" } },
      { rowId: "row-b", lifecycleState: "active", fields: { es: "Adios", vi: "" } },
      { rowId: "row-c", lifecycleState: "active", fields: { es: "Gracias", vi: "" } },
    ],
    aiTranslateAllModal: {
      ...createEditorAiTranslateAllModalState(),
      isOpen: true,
      selectedLanguageCodes: ["vi"],
    },
  };
}

function batchOperations(overrides = {}) {
  return {
    ensureEditorAiTranslateProviderReady: async () => ({
      ok: true,
      providerId: "openai",
      modelId: "gpt-5.5",
    }),
    updateEditorRowFieldValue: (rowId, languageCode, value) => {
      const row = state.editorChapter.rows.find((candidate) => candidate.rowId === rowId);
      if (row) {
        row.fields[languageCode] = value;
      }
    },
    persistEditorRowOnBlur: async () => {},
    ...overrides,
  };
}

test("AI Translate All batches consecutive same-pair rows into one request", async () => {
  resetSessionState();
  editorAiTranslateAllTestApi.resetActiveBatchRunId();
  state.editorChapter = batchChapter();
  const batchCalls = [];

  await confirmEditorAiTranslateAll(
    () => {},
    batchOperations({
      runAiTranslationBatch: async (request) => {
        batchCalls.push(request);
        return {
          rows: request.rows.map((row) => ({
            rowId: row.rowId,
            translatedText: `vi:${row.sourceText}`,
            translatedFootnote: "",
            translatedImageCaption: "",
          })),
          promptText: "P",
        };
      },
    }),
  );

  assert.equal(batchCalls.length, 1);
  assert.equal(batchCalls[0].rows.length, 3);
  assert.deepEqual(
    state.editorChapter.rows.map((row) => row.fields.vi),
    ["vi:Hola", "vi:Adios", "vi:Gracias"],
  );
  assert.equal(state.editorChapter.aiTranslateAllModal.isOpen, false);
  assert.equal(state.statusBadges.left.text, "AI translated 3 fields.");
});

test("AI Translate All falls back to single-row for rows missing from the batch response", async () => {
  resetSessionState();
  editorAiTranslateAllTestApi.resetActiveBatchRunId();
  state.editorChapter = batchChapter();
  const fallbackRows = [];

  await confirmEditorAiTranslateAll(
    () => {},
    batchOperations({
      runAiTranslationBatch: async (request) => ({
        rows: request.rows
          .filter((row) => row.rowId !== "row-b")
          .map((row) => ({ rowId: row.rowId, translatedText: `vi:${row.sourceText}` })),
        promptText: "P",
      }),
      runEditorAiTranslateForContext: async (_render, _actionId, context) => {
        fallbackRows.push(context.rowId);
        const row = state.editorChapter.rows.find((candidate) => candidate.rowId === context.rowId);
        row.fields[context.targetLanguageCode] = "vi:fallback";
        return { ok: true };
      },
    }),
  );

  assert.deepEqual(fallbackRows, ["row-b"]);
  assert.equal(state.editorChapter.rows.find((r) => r.rowId === "row-a").fields.vi, "vi:Hola");
  assert.equal(state.editorChapter.rows.find((r) => r.rowId === "row-b").fields.vi, "vi:fallback");
});

test("AI Translate All falls back to single-row for the whole batch when the request throws", async () => {
  resetSessionState();
  editorAiTranslateAllTestApi.resetActiveBatchRunId();
  state.editorChapter = batchChapter();
  const fallbackRows = [];

  await confirmEditorAiTranslateAll(
    () => {},
    batchOperations({
      runAiTranslationBatch: async () => {
        throw new Error("network down");
      },
      runEditorAiTranslateForContext: async (_render, _actionId, context) => {
        fallbackRows.push(context.rowId);
        const row = state.editorChapter.rows.find((candidate) => candidate.rowId === context.rowId);
        row.fields[context.targetLanguageCode] = `vi:${row.fields.es}`;
        return { ok: true };
      },
    }),
  );

  assert.deepEqual(fallbackRows, ["row-a", "row-b", "row-c"]);
  assert.deepEqual(
    state.editorChapter.rows.map((row) => row.fields.vi),
    ["vi:Hola", "vi:Adios", "vi:Gracias"],
  );
});

test("AI Translate All derives the glossary once for a derived-glossary batch", async () => {
  resetSessionState();
  editorAiTranslateAllTestApi.resetActiveBatchRunId();
  // Glossary source language (en) differs from the chapter source (es) => derived.
  state.editorChapter = {
    ...batchChapter(),
    glossary: {
      sourceLanguage: { code: "en" },
      targetLanguage: { code: "vi" },
      glossaryId: "g1",
      repoName: "repo",
      title: "Glossary",
      matcherModel: {},
      terms: [
        {
          lifecycleState: "active",
          sourceTerms: ["hola"],
          targetTerms: ["xin chao"],
        },
      ],
    },
  };

  const prepareCalls = [];
  const batchCalls = [];

  await confirmEditorAiTranslateAll(
    () => {},
    batchOperations({
      prepareEditorAiTranslatedGlossaryBatch: async (request) => {
        prepareCalls.push(request);
        return { glossarySourceText: "combined", entries: [] };
      },
      runAiTranslationBatch: async (request) => {
        batchCalls.push(request);
        return {
          rows: request.rows.map((row) => ({
            rowId: row.rowId,
            translatedText: `vi:${row.sourceText}`,
          })),
          promptText: "P",
        };
      },
    }),
  );

  // One batch-wide derivation call carrying every row's source text, not one per row.
  assert.equal(prepareCalls.length, 1);
  assert.deepEqual(prepareCalls[0].translationSourceTexts, ["Hola", "Adios", "Gracias"]);
  // Still a single batch translation call for the whole batch.
  assert.equal(batchCalls.length, 1);
  assert.equal(batchCalls[0].rows.length, 3);
  assert.deepEqual(
    state.editorChapter.rows.map((row) => row.fields.vi),
    ["vi:Hola", "vi:Adios", "vi:Gracias"],
  );
});

test("glossaryUsageKindForPair classifies none/direct/derived from the chapter glossary", () => {
  const noGlossary = editorAiTranslateAllTestApi.glossaryUsageKindForPair(
    { languages: [{ code: "es" }, { code: "vi" }] },
    "es",
    "vi",
  );
  assert.equal(noGlossary, "none");

  const chapterState = {
    languages: [
      { code: "es", name: "Spanish", role: "source" },
      { code: "vi", name: "Vietnamese", role: "target" },
    ],
    glossary: {
      sourceLanguage: { code: "es" },
      targetLanguage: { code: "vi" },
      matcherModel: {},
    },
  };
  assert.equal(editorAiTranslateAllTestApi.glossaryUsageKindForPair(chapterState, "es", "vi"), "direct");

  const derivedChapter = {
    ...chapterState,
    glossary: {
      sourceLanguage: { code: "en" },
      targetLanguage: { code: "vi" },
      matcherModel: {},
    },
    languages: [
      { code: "es", name: "Spanish", role: "source" },
      { code: "vi", name: "Vietnamese", role: "target" },
    ],
  };
  assert.equal(editorAiTranslateAllTestApi.glossaryUsageKindForPair(derivedChapter, "es", "vi"), "derived");
});
