import test from "node:test";
import assert from "node:assert/strict";

import { buildEditorDerivedGlossaryModel, buildEditorGlossaryModel } from "./editor-glossary-highlighting.js";
import { buildCachedEditorRowGlossaryHighlights, editorRowHasGlossaryError } from "./editor-glossary-highlight-cache.js";
import { buildEditorGlossaryRevisionKey } from "./editor-derived-glossary-state.js";

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

test("chapter diagnostics survive viewport cache eviction without repeating glossary matching", () => {
  const glossary = buildDirectGlossaryState();
  const sourceMatcher = glossary.matcherModel.sourceMatcher;
  let matcherReads = 0;
  Object.defineProperty(glossary.matcherModel, "sourceMatcher", {
    get() { matcherReads += 1; return sourceMatcher; },
  });
  const rows = Array.from({ length: 450 }, (_, index) => ({
    rowId: `row-${index}`, fields: { es: "intelectual", vi: "" },
  }));
  const chapter = {
    chapterId: "diagnostic-cache-test", glossary, rows,
    languages: [{ code: "es" }, { code: "vi" }],
  };
  for (const row of rows) assert.equal(editorRowHasGlossaryError(row, chapter), true);
  assert.ok(matcherReads > 0);
  // Filling the bounded HTML cache must not evict the chapter's diagnostics.
  for (const row of rows) buildCachedEditorRowGlossaryHighlights(row, chapter);
  matcherReads = 0;
  for (const row of rows) assert.equal(editorRowHasGlossaryError(row, chapter), true);
  assert.equal(matcherReads, 0);

  rows[0].fields.vi = "lý trí";
  assert.equal(editorRowHasGlossaryError(rows[0], chapter), false);
  assert.ok(matcherReads > 0);
  matcherReads = 0;
  for (const row of rows.slice(1)) assert.equal(editorRowHasGlossaryError(row, chapter), true);
  assert.equal(matcherReads, 0);

  // Removing and then reinserting a row must release its diagnostic entry.
  chapter.rows = rows.slice(1);
  editorRowHasGlossaryError(rows[1], chapter);
  chapter.rows = rows;
  matcherReads = 0;
  assert.equal(editorRowHasGlossaryError(rows[0], chapter), false);
  assert.ok(matcherReads > 0);

  chapter.languages = [{ code: "es" }];
  assert.equal(editorRowHasGlossaryError(rows[1], chapter), false);
  chapter.languages = [{ code: "es" }, { code: "vi" }];
  assert.equal(editorRowHasGlossaryError(rows[1], chapter), true);
});

test("diagnostics skip tooltip construction and custom HTML even when an error was cached", () => {
  const glossary = buildDirectGlossaryState();
  Object.defineProperty(glossary.matcherModel, "title", {
    get() { assert.fail("diagnostics must not build tooltip payloads"); },
  });
  const row = { rowId: "row", fields: { es: "intelectual", vi: "" } };
  const chapter = {
    chapterId: "diagnostic-no-html", glossary, rows: [row],
    languages: [{ code: "es" }, { code: "vi" }],
  };
  assert.equal(editorRowHasGlossaryError(row, chapter), true);
  row.textStyle = "custom_html";
  assert.equal(editorRowHasGlossaryError(row, chapter), false);
  row.textStyle = "paragraph";
  assert.equal(editorRowHasGlossaryError(row, chapter), true);
});

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
        glossaryRevisionKey: buildEditorGlossaryRevisionKey(buildDirectGlossaryState()),
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
  assert.equal(highlights.get("es").hasErrors, false);
  assert.equal(highlights.get("en").hasErrors, false);
  assert.equal(highlights.get("vi").hasErrors, false);
  assert.equal(editorRowHasGlossaryError(row, chapterState), false);

  row.fields.vi = "";
  const missing = buildCachedEditorRowGlossaryHighlights(row, chapterState);
  assert.equal(missing.get("es").hasErrors, true);
  assert.equal(missing.get("en").hasErrors, true);
  assert.equal(editorRowHasGlossaryError(row, chapterState), true);

  row.fields.vi = "lý trí";
  const partiallyFixed = buildCachedEditorRowGlossaryHighlights(row, chapterState);
  assert.equal(partiallyFixed.get("es").hasErrors, true);
  assert.equal(partiallyFixed.get("en").hasErrors, false);
  assert.equal(editorRowHasGlossaryError(row, chapterState), true);

  // Direct matches are satisfied while the derived source still requires a
  // different variant. Replacing the entry/model must invalidate diagnostics.
  row.fields.vi = "trung tâm lý trí";
  const entry = chapterState.derivedGlossariesByRowId[row.rowId];
  chapterState.derivedGlossariesByRowId[row.rowId] = {
    ...entry,
    requestKey: "replacement-request",
    matcherModel: buildEditorDerivedGlossaryModel({
      sourceLanguage: { code: "en" }, targetLanguage: { code: "vi" },
      entries: [{ sourceTerm: "intellectual", targetVariants: ["different variant"] }],
    }),
  };
  assert.equal(editorRowHasGlossaryError(row, chapterState), true);
  const derivedError = buildCachedEditorRowGlossaryHighlights(row, chapterState);
  assert.equal(derivedError.get("en").hasErrors, true);

  // Editing the source makes that derived entry stale, leaving only the valid
  // direct glossary. The old diagnostic must not keep the row in the filter.
  row.fields.en = "A changed source.";
  assert.equal(editorRowHasGlossaryError(row, chapterState), false);
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
  assert.equal(missingTargetHighlights.get("en").hasErrors, true);
  assert.equal(missingTargetHighlights.has("zh-Hant"), false);

  row.fields["zh-Hant"] = "我們的存在層次可以改變。";
  const matchingTargetHighlights = buildCachedEditorRowGlossaryHighlights(row, chapterState);

  assert.doesNotMatch(matchingTargetHighlights.get("en")?.html ?? "", /glossary-match-error/);
  assert.equal(matchingTargetHighlights.get("en").hasErrors, false);
  assert.match(
    matchingTargetHighlights.get("zh-Hant")?.html ?? "",
    /<mark[^>]*>存在層次<\/mark>/,
  );
});
