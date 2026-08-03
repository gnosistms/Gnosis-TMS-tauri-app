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

test("Chinese target edits invalidate highlights when glossary script-code casing differs", () => {
  const glossary = {
    glossaryId: "glossary-zh-hant",
    repoName: "glossary-zh-hant",
    title: "English to Traditional Chinese",
    sourceLanguage: { code: "en", name: "English" },
    targetLanguage: { code: "zh-hant", name: "Chinese (Traditional)" },
    terms: [{
      termId: "term-zh-1",
      sourceTerms: ["Level of Being"],
      targetTerms: ["存在層次"],
    }],
  };
  const row = {
    rowId: "row-zh-1",
    fields: {
      en: "Our Level of Being can change.",
      "zh-Hant": "我們可以改變。",
    },
  };
  const chapterState = {
    chapterId: "chapter-zh-1",
    languages: [
      { code: "en", name: "English" },
      { code: "zh-Hant", name: "Chinese (Traditional)" },
    ],
    glossary: {
      ...glossary,
      matcherModel: buildEditorGlossaryModel(glossary),
    },
    rows: [row],
    derivedGlossariesByRowId: {},
  };

  const missingTargetHighlights = buildCachedEditorRowGlossaryHighlights(row, chapterState);
  assert.match(missingTargetHighlights.get("en")?.html ?? "", /glossary-match-error/);
  assert.equal(missingTargetHighlights.has("zh-Hant"), false);

  row.fields["zh-Hant"] = "我們的存在層次可以改變。";
  const matchingTargetHighlights = buildCachedEditorRowGlossaryHighlights(row, chapterState);

  assert.doesNotMatch(matchingTargetHighlights.get("en")?.html ?? "", /glossary-match-error/);
  assert.match(
    matchingTargetHighlights.get("zh-Hant")?.html ?? "",
    /<mark[^>]*>存在層次<\/mark>/,
  );
});
