import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEditorDerivedGlossaryContext,
  editorDerivedGlossaryMatchesContext,
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
});

test("row-sourced derived glossary entries do not match after the glossary-source field becomes empty", () => {
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
