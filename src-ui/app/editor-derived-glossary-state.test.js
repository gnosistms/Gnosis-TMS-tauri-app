import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEditorDerivedGlossaryContext,
  editorDerivedGlossaryMatchesContext,
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
