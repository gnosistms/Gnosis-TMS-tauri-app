import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEditorDerivedGlossaryContext,
  editorDerivedGlossaryIsStale,
  editorDerivedGlossaryMatchesContext,
  hydrateEditorDerivedGlossaryEntryState,
  resolveHighlightableEditorDerivedGlossaryEntry,
  resolveEditorDerivedGlossarySourceText,
} from "./editor-derived-glossary-state.js";

function readyDerivedEntry(overrides = {}) {
  return {
    status: "ready",
    error: "",
    requestKey: "req-1",
    translationSourceLanguageCode: "en",
    glossarySourceLanguageCode: "es",
    targetLanguageCode: "vi",
    translationSourceText: "The inner chamber glows.",
    glossarySourceText: "La camara interior brilla.",
    glossarySourceTextOrigin: "generated",
    glossaryRevisionKey: "rev-1",
    entries: [],
    matcherModel: { sourceLanguage: { code: "en" }, targetLanguage: { code: "vi" } },
    ...overrides,
  };
}

test("generated derived glossary entries match when the live glossary-source field is still empty", () => {
  const entry = readyDerivedEntry();
  const context = buildEditorDerivedGlossaryContext({
    translationSourceLanguageCode: "en",
    glossarySourceLanguageCode: "es",
    targetLanguageCode: "vi",
    translationSourceText: "The inner chamber glows.",
    glossarySourceText: "",
    glossaryRevisionKey: "rev-1",
  });

  assert.equal(editorDerivedGlossaryMatchesContext(entry, context), true);
  assert.equal(editorDerivedGlossaryIsStale(entry, context), false);
});

test("row-sourced derived glossary entries become stale after the glossary-source field becomes empty", () => {
  const entry = readyDerivedEntry({
    glossarySourceTextOrigin: "row",
  });
  const context = buildEditorDerivedGlossaryContext({
    translationSourceLanguageCode: "en",
    glossarySourceLanguageCode: "es",
    targetLanguageCode: "vi",
    translationSourceText: "The inner chamber glows.",
    glossarySourceText: "",
    glossaryRevisionKey: "rev-1",
  });

  assert.equal(editorDerivedGlossaryMatchesContext(entry, context), false);
  assert.equal(editorDerivedGlossaryIsStale(entry, context), true);
});

test("derived glossary entries become stale when the translation source text changes", () => {
  const entry = readyDerivedEntry();
  const context = buildEditorDerivedGlossaryContext({
    translationSourceLanguageCode: "en",
    glossarySourceLanguageCode: "es",
    targetLanguageCode: "vi",
    translationSourceText: "The inner chamber now glows brightly.",
    glossarySourceText: "",
    glossaryRevisionKey: "rev-1",
  });

  assert.equal(editorDerivedGlossaryMatchesContext(entry, context), false);
  assert.equal(editorDerivedGlossaryIsStale(entry, context), true);
});

test("hydrateEditorDerivedGlossaryEntryState rebuilds the matcher model for a persisted ready entry", () => {
  const hydratedEntry = hydrateEditorDerivedGlossaryEntryState(
    readyDerivedEntry({
      matcherModel: null,
      entries: [{
        sourceTerm: "inner chamber",
        glossarySourceTerm: "camara interior",
        targetVariants: ["buong noi tam"],
        notes: ["Dung thuat ngu cua glossary"],
      }],
    }),
    [
      { code: "en", name: "English" },
      { code: "es", name: "Spanish" },
      { code: "vi", name: "Vietnamese" },
    ],
    {
      glossaryId: "glossary-1",
      repoName: "glossary-1",
      title: "Glossary",
    },
  );

  assert.equal(hydratedEntry.matcherModel?.sourceLanguage?.code, "en");
  assert.equal(hydratedEntry.matcherModel?.targetLanguage?.code, "vi");
});

test("resolveEditorDerivedGlossarySourceText regenerates the pivot when the source changed but the glossary-source field did not", () => {
  const source = resolveEditorDerivedGlossarySourceText(
    {
      fields: {
        en: "The inner chamber now glows brightly.",
        es: "La camara interior brilla.",
      },
      persistedFields: {
        en: "The inner chamber glows.",
        es: "La camara interior brilla.",
      },
    },
    "en",
    "es",
  );

  assert.deepEqual(source, {
    glossarySourceText: "",
    glossarySourceTextOrigin: "generated",
  });
});

test("resolveEditorDerivedGlossarySourceText reuses the row text when the glossary-source field changed alongside the source", () => {
  const source = resolveEditorDerivedGlossarySourceText(
    {
      fields: {
        en: "The inner chamber now glows brightly.",
        es: "La camara interior ahora brilla mas.",
      },
      persistedFields: {
        en: "The inner chamber glows.",
        es: "La camara interior brilla.",
      },
    },
    "en",
    "es",
  );

  assert.deepEqual(source, {
    glossarySourceText: "La camara interior ahora brilla mas.",
    glossarySourceTextOrigin: "row",
  });
});

test("resolveHighlightableEditorDerivedGlossaryEntry ignores stale entries after a glossary revision change", () => {
  const entry = readyDerivedEntry({
    rowId: "row-1",
  });
  const chapterState = {
    glossary: {
      glossaryId: "glossary-1",
      repoName: "glossary-1",
      sourceLanguage: { code: "es", name: "Spanish" },
      targetLanguage: { code: "vi", name: "Vietnamese" },
      terms: [
        {
          termId: "term-1",
          sourceTerms: ["camara interior"],
          targetTerms: ["buong noi tam"],
        },
      ],
    },
    rows: [
      {
        rowId: "row-1",
        fields: {
          en: "The inner chamber glows.",
          es: "La camara interior brilla.",
          vi: "Buong noi tam dang sang.",
        },
        persistedFields: {
          en: "The inner chamber glows.",
          es: "La camara interior brilla.",
          vi: "Buong noi tam dang sang.",
        },
      },
    ],
    derivedGlossariesByRowId: {
      "row-1": entry,
    },
  };

  assert.equal(resolveHighlightableEditorDerivedGlossaryEntry(chapterState, "row-1"), null);
});
