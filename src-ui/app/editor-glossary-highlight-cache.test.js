import test from "node:test";
import assert from "node:assert/strict";

import { buildEditorDerivedGlossaryModel, buildEditorGlossaryModel } from "./editor-glossary-highlighting.js";
import { buildCachedEditorRowGlossaryHighlights } from "./editor-glossary-highlight-cache.js";

function buildDirectGlossaryState() {
  const glossary = {
    glossaryId: "glossary-1",
    repoName: "glossary-1",
    title: "Glossary",
    sourceLanguage: {
      code: "es",
      name: "Spanish",
    },
    targetLanguage: {
      code: "vi",
      name: "Vietnamese",
    },
    terms: [
      {
        termId: "term-1",
        sourceTerms: ["intelectual"],
        targetTerms: ["lý trí"],
      },
      {
        termId: "term-2",
        sourceTerms: ["el intelectual"],
        targetTerms: ["trung tâm lý trí"],
      },
    ],
  };

  return {
    ...glossary,
    matcherModel: buildEditorGlossaryModel(glossary),
  };
}

test("direct glossary target highlights take precedence over derived target highlights", () => {
  const row = {
    rowId: "row-1",
    fields: {
      es: "El intelectual.",
      en: "The intellectual.",
      vi: "trung tâm lý trí.",
    },
  };
  const chapterState = {
    chapterId: "chapter-1",
    languages: [
      { code: "es", name: "Spanish" },
      { code: "en", name: "English" },
      { code: "vi", name: "Vietnamese" },
    ],
    glossary: buildDirectGlossaryState(),
    rows: [row],
    derivedGlossariesByRowId: {
      "row-1": {
        status: "ready",
        error: "",
        requestKey: "req-1",
        translationSourceLanguageCode: "en",
        glossarySourceLanguageCode: "es",
        targetLanguageCode: "vi",
        translationSourceText: "The intellectual.",
        glossarySourceText: "El intelectual.",
        glossarySourceTextOrigin: "row",
        glossaryRevisionKey: JSON.stringify({
          glossaryId: "glossary-1",
          repoName: "glossary-1",
          sourceLanguageCode: "es",
          targetLanguageCode: "vi",
          terms: [
            {
              termId: "term-1",
              sourceTerms: ["intelectual"],
              targetTerms: ["lý trí"],
              notes: [],
            },
            {
              termId: "term-2",
              sourceTerms: ["el intelectual"],
              targetTerms: ["trung tâm lý trí"],
              notes: [],
            },
          ],
        }),
        entries: [
          {
            sourceTerm: "intellectual",
            glossarySourceTerm: "intelectual",
            targetVariants: ["lý trí"],
            notes: [],
          },
        ],
        matcherModel: buildEditorDerivedGlossaryModel({
          sourceLanguage: { code: "en", name: "English" },
          targetLanguage: { code: "vi", name: "Vietnamese" },
          entries: [
            {
              sourceTerm: "intellectual",
              glossarySourceTerm: "intelectual",
              targetVariants: ["lý trí"],
              notes: [],
            },
          ],
          glossaryId: "glossary-1",
          repoName: "glossary-1",
          title: "Glossary",
        }),
      },
    },
  };

  const highlights = buildCachedEditorRowGlossaryHighlights(row, chapterState);

  assert.match(highlights.get("es")?.html ?? "", />El intelectual<\/mark>/);
  assert.match(highlights.get("en")?.html ?? "", />intellectual<\/mark>/);
  assert.match(highlights.get("vi")?.html ?? "", />trung tâm lý trí<\/mark>/);
  assert.doesNotMatch(highlights.get("vi")?.html ?? "", />lý trí<\/mark>/);
});
