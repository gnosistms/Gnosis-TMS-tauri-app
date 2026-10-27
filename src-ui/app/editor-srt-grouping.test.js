import test from "node:test";
import assert from "node:assert/strict";
import { srtGroupsForChapter, projectSrtDisplayRows } from "./editor-srt-grouping.js";
import { buildEditorFilterResult } from "./editor-filters.js";
import { buildEditorGlossaryModel } from "./editor-glossary-highlighting.js";
import { buildCachedEditorRowGlossaryHighlights } from "./editor-glossary-highlight-cache.js";

function chapter(texts, overrides = {}) {
  return { srtViewMode: "group-fragments", sourceFormats: ["srt"], selectedSourceLanguageCode: "en", languages: [{ code: "en" }], rows: texts.map((text, i) => ({ rowId: String(i), fields: { en: text }, srtTiming: { startMs: i * 1000, endMs: (i + 1) * 1000 }, ...overrides[i] })) };
}
const ids = (state) => srtGroupsForChapter(state).map((rows) => rows.map((row) => row.rowId));

test("grouping uses terminal source punctuation without splitting a cue internally", () => {
  assert.deepEqual(ids(chapter(["Hello", "world.”", "One. Two", "more."])), [["0", "1"], ["2", "3"]]);
  assert.deepEqual(ids(chapter(["Ask Dr.", "Smith.", "OK?"])), [["0", "1"], ["2"]]);
});

test("Unicode punctuation, initials, decimals, overlaps and final unfinished sentences", () => {
  for (const end of ["。", "？", "！", "…", "؟", "।"]) assert.deepEqual(ids(chapter([`Done${end}`, "next"])), [["0"], ["1"]]);
  assert.deepEqual(ids(chapter(["A.", "Smith", "paid 3.14", "today"])), [["0", "1", "2", "3"]]);
  assert.deepEqual(ids(chapter(["<ruby>終<rt>end</rt></ruby>。", "next"])), [["0"], ["1"]]);
  assert.deepEqual(ids(chapter(["a", "b"], { 1: { srtTiming: { startMs: 900, endMs: 2000 } } })), [["0", "1"]]);
  assert.deepEqual(ids(chapter(["a", "b", "c"], { 1: { srtTiming: { startMs: 2000, endMs: 1000 } } })), [["0"], ["1"], ["2"]]);
});

test("pause splitting is off by default, even with long gaps", () => {
  const state = chapter(["a", "b", "c."], { 1: { srtTiming: { startMs: 10_000, endMs: 11_000 } }, 2: { srtTiming: { startMs: 20_000, endMs: 21_000 } } });
  assert.deepEqual(ids(state), [["0", "1", "2"]]);
});

test("enabled pause splitting uses strict selected thresholds and the source timing override", () => {
  for (const threshold of [500, 750, 1000, 1500, 2000, 2500, 3000]) {
    for (const gap of [threshold - 1, threshold, threshold + 1]) {
      const state = chapter(["a", "b"], { 1: { timings: { en: { startMs: 1000 + gap, endMs: 6000 } } } });
      state.srtPauseSplitEnabled = true;
      state.srtPauseThresholdMs = threshold;
      assert.equal(ids(state).length, gap > threshold ? 2 : 1, `${gap}ms against ${threshold}ms`);
    }
  }
});

test("changing pause options invalidates groups for the same rows without altering punctuation boundaries", () => {
  const state = chapter(["a", "b.", "c"], { 1: { srtTiming: { startMs: 1800, endMs: 2000 } } });
  assert.deepEqual(ids(state), [["0", "1"], ["2"]]);
  state.srtPauseSplitEnabled = true;
  assert.deepEqual(ids(state), [["0"], ["1"], ["2"]]);
  state.srtPauseThresholdMs = 1000;
  assert.deepEqual(ids(state), [["0", "1"], ["2"]]);
  state.srtPauseThresholdMs = 750;
  assert.deepEqual(ids(state), [["0"], ["1"], ["2"]]);
  state.srtPauseSplitEnabled = false;
  assert.deepEqual(ids(state), [["0", "1"], ["2"]]);
});

test("deleted, missing timing and conflicting cues interrupt groups", () => {
  for (const override of [{ lifecycleState: "deleted" }, { srtTiming: null }, { freshness: "conflict", conflictState: { status: "unresolved" } }]) {
    assert.deepEqual(ids(chapter(["a", "b", "c"], { 1: override })), [["0"], ["1"], ["2"]]);
  }
});

test("viewing groups does not mutate rows; Standard leaves all cues separate", () => {
  const state = chapter(["a", "b", "c"]);
  const before = structuredClone(state);
  assert.deepEqual(ids(state), [["0", "1", "2"]]);
  assert.deepEqual(state, before);
  state.srtViewMode = "standard";
  assert.deepEqual(ids(state), [["0"], ["1"], ["2"]]);
});

test("a conflict never attaches the captured draft to a smaller group", () => {
  const state = chapter(["a", "b", "c", "d", "e"]);
  state.srtGroupEdits = { "0:en": { key: "0:en", memberRowIds: ["0", "1", "2", "3", "4"],
    markers: ["⟦1⟧", "⟦2⟧", "⟦3⟧", "⟦4⟧"], draft: "local⟦1⟧b⟦2⟧c⟦3⟧d⟦4⟧e", savedDraft: "original" } };
  state.rows = state.rows.map((row, index) => index === 2 ? { ...row, freshness: "conflict", conflictState: { status: "unresolved" } } : row);
  assert.deepEqual(ids(state), [["0"], ["1"], ["2"], ["3"], ["4"]]);
  const projected = projectSrtDisplayRows(state.rows, state, state.languages);
  assert.equal(projected[0].fields.en, "a");
  assert.ok(projected.every((row) => !row.srtGroup));
});

function displayChapter(targetTexts = ["Nueva", "", "York"]) {
  const state = chapter(["New", "York", "city."]);
  state.chapterId = "group-chapter";
  state.languages = [{ code: "en", name: "English" }, { code: "es", name: "Spanish" }];
  state.rows = state.rows.map((row, index) => ({ ...row, id: row.rowId, kind: "row", commentCount: index === 1 ? 2 : 0,
    fields: { ...row.fields, es: targetTexts[index] }, sections: state.languages.map(({ code }) => ({ code,
      text: code === "en" ? row.fields.en : targetTexts[index], reviewed: index < 2, pleaseCheck: index === 1,
      showTiming: true, timingEndError: index === 2,
    })) }));
  return state;
}

test("group status filters use all-reviewed, any-please-check, all-empty and first-row comments", () => {
  const state = displayChapter();
  const rows = projectSrtDisplayRows(state.rows, state, state.languages);
  const matches = (mode) => buildEditorFilterResult({ rows, languages: state.languages, targetLanguageCode: "es", filters: { rowFilterMode: mode } }).filteredRows.length;
  assert.equal(rows.length, 1);
  assert.equal(matches("reviewed"), 0);
  assert.equal(matches("not-reviewed"), 1);
  assert.equal(matches("please-check"), 1);
  assert.equal(matches("target-empty"), 0);
  assert.equal(matches("has-comments"), 0);
  assert.equal(matches("has-timing-error"), 1);
  assert.ok(rows[0].sections.every((section) => !section.showTiming));
  const blank = displayChapter(["", "<em></em>", " "]);
  assert.equal(buildEditorFilterResult({ rows: projectSrtDisplayRows(blank.rows, blank, blank.languages), languages: blank.languages, targetLanguageCode: "es", filters: { rowFilterMode: "target-empty" } }).filteredRows.length, 1);
});

test("search and glossary matches span fragments without treating markers as content", () => {
  const state = displayChapter();
  state.glossary = { glossaryId: "group-glossary", repoName: "group-glossary", matcherModel: buildEditorGlossaryModel({ sourceLanguage: { code: "en" }, targetLanguage: { code: "es" }, terms: [{ sourceTerms: ["New York"], targetTerms: ["Nueva York"] }] }) };
  const rows = projectSrtDisplayRows(state.rows, state, state.languages);
  const result = buildEditorFilterResult({ rows, languages: state.languages, targetLanguageCode: "es", filters: { searchQuery: "New York" } });
  assert.equal(result.filteredRows.length, 1);
  const highlights = buildCachedEditorRowGlossaryHighlights(rows[0], state);
  assert.equal(highlights.get("en").hasErrors, false);
  assert.equal(highlights.get("es").hasMatches, true);
  assert.equal(buildEditorFilterResult({ rows, languages: state.languages, filters: { searchQuery: "⟦1⟧" } }).filteredRows.length, 0);
});
