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
  setTimeout() {
    return 1;
  },
  clearTimeout() {},
};

const {
  resolveEditorDerivedGlossaryUsage,
} = await import("./editor-derived-glossary-flow.js");

const EN = { code: "en", name: "English", role: "source" };
const ES_2 = { code: "es-x-2", baseCode: "es", name: "Spanish 2", role: "target" };
const VI = { code: "vi", name: "Vietnamese", role: "target" };

function esViGlossary() {
  return {
    sourceLanguage: { code: "es" },
    targetLanguage: { code: "vi" },
    matcherModel: {},
    terms: [
      { lifecycleState: "active", sourceTerms: ["luz"], targetTerms: ["ánh sáng"] },
    ],
  };
}

function chapter(languages, glossary = esViGlossary()) {
  return { chapterId: "chapter-1", projectId: "project-1", languages, glossary };
}

test("resolveEditorDerivedGlossaryUsage returns none without a pivot column and derived with one", () => {
  const row = { rowId: "row-1", fields: { en: "Light", es: "Luz", vi: "" } };
  const contextFor = (chapterState) => ({
    chapterState,
    projectId: chapterState.projectId,
    chapterId: chapterState.chapterId,
    row,
    rowId: row.rowId,
    sourceLanguageCode: "en",
    targetLanguageCode: "vi",
    sourceLanguage: EN,
    targetLanguage: VI,
    sourceText: "Light",
  });

  assert.equal(resolveEditorDerivedGlossaryUsage(contextFor(chapter([EN, VI]))).kind, "none");

  const usage = resolveEditorDerivedGlossaryUsage(contextFor(chapter([EN, ES_2, VI])));
  assert.equal(usage.kind, "derived");
  // The pivot column code is the chapter column's own code, never the bare
  // glossary code.
  assert.equal(usage.glossarySourceLanguageCode, "es-x-2");
});
