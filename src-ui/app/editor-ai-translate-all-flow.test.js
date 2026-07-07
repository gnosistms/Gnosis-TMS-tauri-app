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
  ensureBatchDerivedGlossaries,
} = await import("./editor-derived-glossary-batch-flow.js");
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
  // The chapter carries an en column with text per row — the pivot text the
  // batch derivation combines (the flow translates the glossary-source language
  // first for exactly this reason).
  const chapterState = batchChapter();
  state.editorChapter = {
    ...chapterState,
    languages: [
      { code: "es", name: "Spanish", role: "source" },
      { code: "en", name: "English", role: "target" },
      { code: "vi", name: "Vietnamese", role: "target" },
    ],
    rows: chapterState.rows.map((row, index) => ({
      ...row,
      fields: { ...row.fields, en: `en-${index}` },
    })),
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
        return { glossarySourceText: request.glossarySourceText, entries: [] };
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
  // The combined pivot text is the join of the rows' glossary-source column text.
  assert.equal(prepareCalls[0].glossarySourceText, "en-0\n\nen-1\n\nen-2");
  // Still a single batch translation call for the whole batch.
  assert.equal(batchCalls.length, 1);
  assert.equal(batchCalls[0].rows.length, 3);
  assert.deepEqual(
    state.editorChapter.rows.map((row) => row.fields.vi),
    ["vi:Hola", "vi:Adios", "vi:Gracias"],
  );
  // Per-row derived entries are stored so highlights and staleness checks work
  // like the single-row path.
  assert.equal(
    state.editorChapter.rows.every(
      (row) => state.editorChapter.derivedGlossariesByRowId?.[row.rowId]?.status === "ready",
    ),
    true,
  );
});

test("AI Translate All generates missing pivot texts in batch instead of single-row fallback", async () => {
  resetSessionState();
  editorAiTranslateAllTestApi.resetActiveBatchRunId();
  // Same derived-glossary setup, but the pivot (en) column starts empty, which
  // previously sent every row through the single-row fallback.
  const chapterState = batchChapter();
  state.editorChapter = {
    ...chapterState,
    languages: [
      { code: "es", name: "Spanish", role: "source" },
      { code: "en", name: "English", role: "target" },
      { code: "vi", name: "Vietnamese", role: "target" },
    ],
    rows: chapterState.rows.map((row) => ({
      ...row,
      fields: { ...row.fields, en: "" },
    })),
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

  const generationCalls = [];
  const translationCalls = [];
  const fallbackRows = [];

  await confirmEditorAiTranslateAll(
    () => {},
    batchOperations({
      prepareEditorAiTranslatedGlossaryBatch: async (request) => ({
        glossarySourceText: request.glossarySourceText,
        entries: [],
      }),
      runAiTranslationBatch: async (request) => {
        if (request.targetLanguageCode === "en") {
          generationCalls.push(request);
          return {
            rows: request.rows.map((row) => ({
              rowId: row.rowId,
              translatedText: `en:${row.sourceText}`,
            })),
          };
        }
        translationCalls.push(request);
        return {
          rows: request.rows.map((row) => ({
            rowId: row.rowId,
            translatedText: `vi:${row.sourceText}`,
          })),
          promptText: "P",
        };
      },
      runEditorAiTranslateForContext: async (_render, _actionId, context) => {
        fallbackRows.push(context.rowId);
        return { ok: true };
      },
    }),
  );

  // Pivot texts were generated in ONE batch call and written into the rows —
  // no single-row fallback.
  assert.deepEqual(fallbackRows, []);
  assert.equal(generationCalls.length, 1);
  assert.deepEqual(
    generationCalls[0].rows.map((row) => row.sourceText),
    ["Hola", "Adios", "Gracias"],
  );
  assert.deepEqual(
    state.editorChapter.rows.map((row) => row.fields.en),
    ["en:Hola", "en:Adios", "en:Gracias"],
  );
  // The es -> vi work still went through one batch translation call.
  assert.equal(translationCalls.length, 1);
  assert.deepEqual(
    state.editorChapter.rows.map((row) => row.fields.vi),
    ["vi:Hola", "vi:Adios", "vi:Gracias"],
  );
  assert.equal(
    state.editorChapter.rows.every(
      (row) => state.editorChapter.derivedGlossariesByRowId?.[row.rowId]?.status === "ready",
    ),
    true,
  );
});

test("AI Translate All skips applying a batch result when the source changed mid-flight", async () => {
  resetSessionState();
  editorAiTranslateAllTestApi.resetActiveBatchRunId();
  state.editorChapter = batchChapter();

  await confirmEditorAiTranslateAll(
    () => {},
    batchOperations({
      runAiTranslationBatch: async (request) => {
        // Simulate the user editing row-b's source while the batch is in flight.
        const rowB = state.editorChapter.rows.find((row) => row.rowId === "row-b");
        rowB.fields.es = "Adios edited";
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

  // row-b's stale translation is NOT applied; the other rows are.
  assert.equal(state.editorChapter.rows.find((row) => row.rowId === "row-a").fields.vi, "vi:Hola");
  assert.equal(state.editorChapter.rows.find((row) => row.rowId === "row-b").fields.vi, "");
  assert.equal(state.editorChapter.rows.find((row) => row.rowId === "row-c").fields.vi, "vi:Gracias");
});

test("AI Translate All skips applying a batch result when the target was filled mid-flight", async () => {
  resetSessionState();
  editorAiTranslateAllTestApi.resetActiveBatchRunId();
  state.editorChapter = batchChapter();

  await confirmEditorAiTranslateAll(
    () => {},
    batchOperations({
      runAiTranslationBatch: async (request) => {
        // Simulate background sync merging a teammate's translation mid-flight.
        const rowB = state.editorChapter.rows.find((row) => row.rowId === "row-b");
        rowB.fields.vi = "teammate translation";
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

  // The teammate's translation is preserved, not overwritten.
  assert.equal(
    state.editorChapter.rows.find((row) => row.rowId === "row-b").fields.vi,
    "teammate translation",
  );
  assert.equal(state.editorChapter.rows.find((row) => row.rowId === "row-a").fields.vi, "vi:Hola");
});

test("AI Translate All batches per language pair when multiple languages are selected", async () => {
  resetSessionState();
  editorAiTranslateAllTestApi.resetActiveBatchRunId();
  const chapterState = batchChapter();
  state.editorChapter = {
    ...chapterState,
    languages: [
      { code: "es", name: "Spanish", role: "source" },
      { code: "vi", name: "Vietnamese", role: "target" },
      { code: "fr", name: "French", role: "target" },
    ],
    rows: chapterState.rows.map((row) => ({
      ...row,
      fields: { ...row.fields, fr: "" },
    })),
    aiTranslateAllModal: {
      ...createEditorAiTranslateAllModalState(),
      isOpen: true,
      selectedLanguageCodes: ["vi", "fr"],
    },
  };
  const batchCalls = [];

  await confirmEditorAiTranslateAll(
    () => {},
    batchOperations({
      runAiTranslationBatch: async (request) => {
        batchCalls.push(request);
        return {
          rows: request.rows.map((row) => ({
            rowId: row.rowId,
            translatedText: `${request.targetLanguageCode}:${row.sourceText}`,
          })),
          promptText: "P",
        };
      },
    }),
  );

  // Row-major work (r1-vi, r1-fr, r2-vi, ...) is regrouped into one batch per
  // language pair — not six singleton fallbacks.
  assert.equal(batchCalls.length, 2);
  assert.deepEqual(
    batchCalls.map((call) => [call.targetLanguageCode, call.rows.length]),
    [["vi", 3], ["fr", 3]],
  );
  assert.deepEqual(
    state.editorChapter.rows.map((row) => row.fields.fr),
    ["fr:Hola", "fr:Adios", "fr:Gracias"],
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

test("AI Translate All refreshes stale derived glossaries once for the whole run when restoring the glossary's own source language", async () => {
  resetSessionState();
  editorAiTranslateAllTestApi.resetActiveBatchRunId();
  // Chapter source en, this run translates en -> es. A linked es -> vi
  // glossary makes es a "pivot" language: en -> vi derived entries can exist
  // pivoting through es, even though translating INTO es (this run) is an
  // ordinary, non-glossary batch (glossaryKind "none" for the es target).
  state.editorChapter = {
    ...createEditorChapterState(),
    chapterId: "chapter-1",
    selectedSourceLanguageCode: "en",
    languages: [
      { code: "en", name: "English", role: "source" },
      { code: "es", name: "Spanish", role: "target" },
      { code: "vi", name: "Vietnamese", role: "target" },
    ],
    rows: [
      { rowId: "row-1", lifecycleState: "active", fields: { en: "Hello one", es: "Hola vieja uno", vi: "Xin chao 1" } },
      { rowId: "row-2", lifecycleState: "active", fields: { en: "Hello two", es: "Hola vieja dos", vi: "Xin chao 2" } },
      { rowId: "row-3", lifecycleState: "active", fields: { en: "Hello three", es: "Hola vieja tres", vi: "" } },
    ],
    glossary: {
      sourceLanguage: { code: "es" },
      targetLanguage: { code: "vi" },
      glossaryId: "g1",
      repoName: "repo",
      title: "Glossary",
      matcherModel: {},
      terms: [{ lifecycleState: "active", sourceTerms: ["hola"], targetTerms: ["xin chao"] }],
    },
    aiTranslateAllModal: {
      ...createEditorAiTranslateAllModalState(),
      isOpen: true,
      selectedLanguageCodes: ["es"],
    },
  };

  // Seed real "ready" en -> vi derived entries (pivoting through the OLD
  // Spanish text) for row-1 and row-2 only — row-3 never had one.
  const seedPrepareCalls = [];
  await ensureBatchDerivedGlossaries({
    chapterState: state.editorChapter,
    items: [
      { rowId: "row-1", sourceLanguageCode: "en", targetLanguageCode: "vi" },
      { rowId: "row-2", sourceLanguageCode: "en", targetLanguageCode: "vi" },
    ],
    providerId: "openai",
    modelId: "test-model",
    operations: {
      prepareEditorAiTranslatedGlossaryBatch: async (request) => {
        seedPrepareCalls.push(request);
        return {
          glossarySourceText: request.glossarySourceText,
          entries: [{ sourceTerm: "Hello", glossarySourceTerm: "hola", targetVariants: ["xin chao"] }],
        };
      },
    },
  });
  assert.equal(seedPrepareCalls.length, 1);
  assert.equal(state.editorChapter.derivedGlossariesByRowId["row-1"].status, "ready");
  assert.equal(state.editorChapter.derivedGlossariesByRowId["row-2"].status, "ready");
  assert.equal(state.editorChapter.derivedGlossariesByRowId["row-3"], undefined);

  // Now clear Spanish across the chapter, as if the user ran Clear
  // Translations before restoring it via Translate All.
  for (const row of state.editorChapter.rows) {
    row.fields.es = "";
  }

  const refreshPrepareCalls = [];
  const glossarySyncCalls = [];
  await confirmEditorAiTranslateAll(
    () => {},
    batchOperations({
      runAiTranslationBatch: async (request) => ({
        rows: request.rows.map((row) => ({ rowId: row.rowId, translatedText: `es:${row.sourceText}` })),
        promptText: "P",
      }),
      prepareEditorAiTranslatedGlossaryBatch: async (request) => {
        refreshPrepareCalls.push(request);
        return {
          glossarySourceText: request.glossarySourceText,
          entries: [{ sourceTerm: "Hello", glossarySourceTerm: "hola", targetVariants: ["xin chao"] }],
        };
      },
      syncEditorGlossaryHighlightRowDom: (rowId) => glossarySyncCalls.push(rowId),
    }),
  );

  assert.deepEqual(
    state.editorChapter.rows.map((row) => row.fields.es),
    ["es:Hello one", "es:Hello two", "es:Hello three"],
  );
  // One combined refresh call for both stale rows, not one per row.
  assert.equal(refreshPrepareCalls.length, 1);
  assert.deepEqual(refreshPrepareCalls[0].translationSourceTexts.slice().sort(), ["Hello one", "Hello two"]);
  assert.equal(state.editorChapter.derivedGlossariesByRowId["row-1"].status, "ready");
  assert.equal(state.editorChapter.derivedGlossariesByRowId["row-1"].glossarySourceText, "es:Hello one");
  assert.equal(state.editorChapter.derivedGlossariesByRowId["row-2"].glossarySourceText, "es:Hello two");
  // row-3 never had a derived entry — no spontaneous derivation for it.
  assert.equal(state.editorChapter.derivedGlossariesByRowId["row-3"], undefined);
  assert.ok(glossarySyncCalls.includes("row-1"));
  assert.ok(glossarySyncCalls.includes("row-2"));
});

// Chapter fixture for pivot-refresh tests: source en, glossary es -> vi, with
// ready en -> vi derived entries seeded for the requested rows (pivoting
// through the CURRENT es text).
async function pivotRefreshChapter({ rowCount, seedRowIds }) {
  state.editorChapter = {
    ...createEditorChapterState(),
    chapterId: "chapter-1",
    selectedSourceLanguageCode: "en",
    languages: [
      { code: "en", name: "English", role: "source" },
      { code: "es", name: "Spanish", role: "target" },
      { code: "vi", name: "Vietnamese", role: "target" },
    ],
    rows: Array.from({ length: rowCount }, (_, index) => ({
      rowId: `row-${index + 1}`,
      lifecycleState: "active",
      fields: { en: `Hello ${index + 1}`, es: `Hola vieja ${index + 1}`, vi: `Xin chao ${index + 1}` },
    })),
    glossary: {
      sourceLanguage: { code: "es" },
      targetLanguage: { code: "vi" },
      glossaryId: "g1",
      repoName: "repo",
      title: "Glossary",
      matcherModel: {},
      terms: [{ lifecycleState: "active", sourceTerms: ["hola"], targetTerms: ["xin chao"] }],
    },
    aiTranslateAllModal: {
      ...createEditorAiTranslateAllModalState(),
      isOpen: true,
      selectedLanguageCodes: ["es"],
    },
  };
  await ensureBatchDerivedGlossaries({
    chapterState: state.editorChapter,
    items: seedRowIds.map((rowId) => ({
      rowId,
      sourceLanguageCode: "en",
      targetLanguageCode: "vi",
    })),
    providerId: "openai",
    modelId: "test-model",
    operations: {
      prepareEditorAiTranslatedGlossaryBatch: async (request) => ({
        glossarySourceText: request.glossarySourceText,
        entries: [{ sourceTerm: "Hello", glossarySourceTerm: "hola", targetVariants: ["xin chao"] }],
      }),
    },
  });
  for (const row of state.editorChapter.rows) {
    row.fields.es = "";
  }
}

test("AI Translate All aggregates fallback-row pivot refreshes into the single run-level call and suppresses the per-row refresh", async () => {
  resetSessionState();
  editorAiTranslateAllTestApi.resetActiveBatchRunId();
  await pivotRefreshChapter({ rowCount: 3, seedRowIds: ["row-1", "row-2"] });

  const fallbackOptions = [];
  const refreshPrepareCalls = [];
  await confirmEditorAiTranslateAll(
    () => {},
    batchOperations({
      // row-2 is missing from the batch response, so it falls back to the
      // single-row path mid-run.
      runAiTranslationBatch: async (request) => ({
        rows: request.rows
          .filter((row) => row.rowId !== "row-2")
          .map((row) => ({ rowId: row.rowId, translatedText: `es:${row.sourceText}` })),
        promptText: "P",
      }),
      runEditorAiTranslateForContext: async (_render, _actionId, context, _operations, options) => {
        fallbackOptions.push(options);
        const row = state.editorChapter.rows.find((candidate) => candidate.rowId === context.rowId);
        row.fields[context.targetLanguageCode] = "es:fallback";
        return { ok: true };
      },
      prepareEditorAiTranslatedGlossaryBatch: async (request) => {
        refreshPrepareCalls.push(request);
        return {
          glossarySourceText: request.glossarySourceText,
          entries: [{ sourceTerm: "Hello", glossarySourceTerm: "hola", targetVariants: ["xin chao"] }],
        };
      },
    }),
  );

  // The fallback row's own refresh was suppressed...
  assert.equal(fallbackOptions.length, 1);
  assert.equal(fallbackOptions[0].suppressDerivedGlossaryRefresh, true);
  // ...and it joined the batch rows in ONE combined run-level refresh.
  assert.equal(refreshPrepareCalls.length, 1);
  assert.deepEqual(refreshPrepareCalls[0].translationSourceTexts.slice().sort(), ["Hello 1", "Hello 2"]);
  assert.equal(state.editorChapter.derivedGlossariesByRowId["row-1"].glossarySourceText, "es:Hello 1");
  assert.equal(state.editorChapter.derivedGlossariesByRowId["row-2"].glossarySourceText, "es:fallback");
});

test("AI Translate All still refreshes pivot rows when the whole run took the single-row path", async () => {
  resetSessionState();
  editorAiTranslateAllTestApi.resetActiveBatchRunId();
  await pivotRefreshChapter({ rowCount: 1, seedRowIds: ["row-1"] });

  const refreshPrepareCalls = [];
  await confirmEditorAiTranslateAll(
    () => {},
    batchOperations({
      // A one-row chapter produces a singleton batch, which never resolves
      // the run-level provider up front — the finally-block refresh must
      // resolve one itself.
      runEditorAiTranslateForContext: async (_render, _actionId, context) => {
        const row = state.editorChapter.rows.find((candidate) => candidate.rowId === context.rowId);
        row.fields[context.targetLanguageCode] = "es:solo";
        return { ok: true };
      },
      prepareEditorAiTranslatedGlossaryBatch: async (request) => {
        refreshPrepareCalls.push(request);
        return {
          glossarySourceText: request.glossarySourceText,
          entries: [{ sourceTerm: "Hello", glossarySourceTerm: "hola", targetVariants: ["xin chao"] }],
        };
      },
    }),
  );

  assert.equal(refreshPrepareCalls.length, 1);
  assert.equal(state.editorChapter.derivedGlossariesByRowId["row-1"].glossarySourceText, "es:solo");
});
