import test from "node:test";
import assert from "node:assert/strict";

import { buildEditorGlossaryModel } from "./editor-glossary-highlighting.js";
import {
  buildEditorAiReviewBatchRequest,
  buildEditorAiReviewRequest,
  editorAiReviewContentFingerprint,
  normalizeEditorAiReviewMode,
} from "./editor-ai-review-request.js";

function row(id, es, vi) {
  return { rowId: id, fields: { es, vi }, footnotes: {}, imageCaptions: {}, fieldStates: {} };
}

function chapterState() {
  return {
    languages: [
      { code: "es", name: "Spanish", role: "source" },
      { code: "vi", name: "Vietnamese", role: "target" },
    ],
    rows: [
      row("r0", "Cero", "Khong"),
      row("r1", "Uno", "Mot"),
      row("r2", "Dos", "Hai"),
      row("r3", "Tres", "Ba"),
    ],
  };
}

test("buildEditorAiReviewBatchRequest grammar mode omits source, history, glossary, context", () => {
  const state = chapterState();
  const request = buildEditorAiReviewBatchRequest({
    chapterState: state,
    rows: [state.rows[1], state.rows[2]],
    sourceLanguageCode: "es",
    targetLanguageCode: "vi",
    providerId: "openai",
    modelId: "gpt-5.5",
    reviewMode: "grammar",
  });

  assert.equal(request.reviewMode, "grammar");
  assert.equal(request.rows.length, 2);
  assert.deepEqual(request.rows.map((r) => r.rowId), ["r1", "r2"]);
  assert.equal(request.rows[0].latestTranslation, "Mot");
  assert.equal(request.rows[0].sourceText, "");
  assert.deepEqual(request.rows[0].targetLanguageHistory, []);
  assert.deepEqual(request.rows[0].qaHints, []);
  assert.deepEqual(request.glossaryHints, []);
  assert.deepEqual(request.contextBefore, []);
  assert.deepEqual(request.contextAfter, []);
});

test("buildEditorAiReviewBatchRequest flags adjacent subtitle cues for meaning review only", () => {
  const state = chapterState();
  state.sourceFormats = ["srt"];
  state.rows.forEach((cue, index) => {
    cue.srtTiming = { startMs: index * 1000, endMs: index * 1000 + 900 };
  });
  const build = (rows, reviewMode) => buildEditorAiReviewBatchRequest({
    chapterState: state,
    rows,
    sourceLanguageCode: "es",
    targetLanguageCode: "vi",
    providerId: "openai",
    modelId: "gpt-5.5",
    reviewMode,
  });

  assert.equal(build([state.rows[1], state.rows[2]], "meaning").subtitleCues, true);
  assert.equal(build([state.rows[1], state.rows[3]], "meaning").subtitleCues, undefined);
  assert.equal(build([state.rows[1], state.rows[2]], "grammar").subtitleCues, undefined);
  delete state.sourceFormats;
  assert.equal(build([state.rows[1], state.rows[2]], "meaning").subtitleCues, undefined);
});

test("buildEditorAiReviewBatchRequest includes per-row QA hints in both modes", () => {
  const state = chapterState();
  const qaHintsByRowId = new Map([
    ["r1", [{ term: "bad", notes: "Use good.", matches: [{ section: "text", text: "Bad" }] }]],
  ]);
  const request = buildEditorAiReviewBatchRequest({
    chapterState: state,
    rows: [state.rows[1], state.rows[2]],
    sourceLanguageCode: "es",
    targetLanguageCode: "vi",
    providerId: "openai",
    modelId: "gpt-5.5",
    reviewMode: "grammar",
    qaHintsByRowId,
  });

  assert.equal(request.rows[0].qaHints[0].term, "bad");
  assert.deepEqual(request.rows[1].qaHints, []);
});

test("buildEditorAiReviewBatchRequest meaning mode includes source, history, and batch context", () => {
  const state = chapterState();
  const historyByRowId = new Map([
    ["r1", [{ revisionNumber: 1, text: "Mot", sourceType: "human" }]],
  ]);
  const request = buildEditorAiReviewBatchRequest({
    chapterState: state,
    rows: [state.rows[1], state.rows[2]],
    sourceLanguageCode: "es",
    targetLanguageCode: "vi",
    providerId: "openai",
    modelId: "gpt-5.5",
    reviewMode: "meaning",
    targetLanguageHistoryByRowId: historyByRowId,
    installationId: 42,
  });

  assert.equal(request.reviewMode, "meaning");
  assert.equal(request.rows[0].sourceText, "Uno");
  assert.equal(request.rows[0].latestTranslation, "Mot");
  assert.equal(request.rows[0].targetLanguageHistory.length, 1);
  // r2 had no history entry -> empty array, not undefined.
  assert.deepEqual(request.rows[1].targetLanguageHistory, []);
  // Batch context walks outward from the first/last batch rows only.
  assert.deepEqual(request.contextBefore.map((c) => c.rowId), ["r0"]);
  assert.deepEqual(request.contextAfter.map((c) => c.rowId), ["r3"]);
  assert.equal(request.installationId, 42);
});

test("AI Review requests preserve structured target and source footnote markers", () => {
  const state = chapterState();
  state.rows[1].footnotes = {
    es: [{ marker: 9, text: "Nota fuente" }],
    vi: [
      { marker: 1, text: "Ghi chu mot" },
      { marker: 2, text: "Ghi chu hai" },
      { marker: 3, text: "Ghi chu ba" },
    ],
  };

  const request = buildEditorAiReviewRequest({
    chapterState: state,
    row: state.rows[1],
    sourceLanguageCode: "es",
    targetLanguageCode: "vi",
    providerId: "openai",
    modelId: "gpt-5.5",
    reviewMode: "meaning",
  });

  assert.deepEqual(request.footnotes, [
    { marker: 1, text: "Ghi chu mot" },
    { marker: 2, text: "Ghi chu hai" },
    { marker: 3, text: "Ghi chu ba" },
  ]);
  assert.deepEqual(request.sourceFootnotes, [{ marker: 9, text: "Nota fuente" }]);
  assert.equal("footnote" in request, false);
  assert.equal("sourceFootnote" in request, false);

  const grammar = buildEditorAiReviewBatchRequest({
    chapterState: state,
    rows: [state.rows[1]],
    sourceLanguageCode: "es",
    targetLanguageCode: "vi",
    providerId: "openai",
    modelId: "gpt-5.5",
    reviewMode: "grammar",
  });
  assert.deepEqual(grammar.rows[0].footnotes, request.footnotes);
  assert.deepEqual(grammar.rows[0].sourceFootnotes, []);
});

test("AI Review clarity requests carry the target text and target-only context, never the source", () => {
  const state = chapterState();
  const single = buildEditorAiReviewRequest({
    chapterState: state,
    row: state.rows[2],
    sourceLanguageCode: "es",
    targetLanguageCode: "vi",
    providerId: "openai",
    modelId: "gpt-5.5",
    reviewMode: "clarity",
  });

  assert.equal(single.reviewMode, "clarity");
  assert.equal(single.rowId, "r2");
  assert.equal(single.latestTranslation, "Hai");
  assert.equal(single.sourceText, "");
  assert.deepEqual(single.glossaryHints, []);
  assert.deepEqual(single.alternateLanguageTexts, []);
  assert.deepEqual(single.rowWindow.map((entry) => entry.targetText), ["Khong", "Mot", "Hai", "Ba"]);

  const batch = buildEditorAiReviewBatchRequest({
    chapterState: state,
    rows: [state.rows[1], state.rows[2]],
    sourceLanguageCode: "es",
    targetLanguageCode: "vi",
    providerId: "openai",
    modelId: "gpt-5.5",
    reviewMode: "clarity",
  });

  assert.equal(batch.reviewMode, "clarity");
  assert.deepEqual(batch.rows.map((r) => r.sourceText), ["", ""]);
  assert.deepEqual(batch.contextBefore.map((entry) => entry.targetText), ["Khong"]);
  assert.deepEqual(batch.contextAfter.map((entry) => entry.targetText), ["Ba"]);
  assert.deepEqual(batch.glossaryHints, []);
  assert.equal(batch.subtitleCues, undefined);
});

test("AI Review clarity requests list the glossary terms underlined in the rows", () => {
  const state = chapterState();
  state.glossary = {
    matcherModel: buildEditorGlossaryModel({
      glossaryId: "g1",
      sourceLanguage: { code: "es", name: "Spanish" },
      targetLanguage: { code: "vi", name: "Vietnamese" },
      terms: [
        { termId: "t1", sourceTerms: ["Uno"], targetTerms: ["Mot", "Mot-alt"] },
        { termId: "t2", sourceTerms: ["Dos"], targetTerms: ["Hai"] },
        { termId: "t3", sourceTerms: ["Tres"], targetTerms: ["Bon"] },
      ],
    }),
  };
  state.rows[2].fields = { es: "Dos y uno", vi: "Hai va Mot" };
  const request = (overrides) => ({
    chapterState: state,
    sourceLanguageCode: "es",
    targetLanguageCode: "vi",
    providerId: "openai",
    modelId: "gpt-5.5",
    reviewMode: "clarity",
    ...overrides,
  });

  assert.deepEqual(buildEditorAiReviewRequest(request({ row: state.rows[1] })).glossaryTerms, [
    { sourceTerm: "Uno", targetTerm: "Mot" },
  ]);
  // Batch terms are deduplicated across rows, ignoring case; "Tres" is not
  // underlined in the target, so it is not listed.
  assert.deepEqual(
    buildEditorAiReviewBatchRequest(request({ rows: state.rows.slice(1) })).glossaryTerms,
    [
      { sourceTerm: "Uno", targetTerm: "Mot" },
      { sourceTerm: "Dos", targetTerm: "Hai" },
    ],
  );
  assert.equal("glossaryTerms" in buildEditorAiReviewRequest(request({ row: state.rows[1], reviewMode: "meaning" })), false);
  assert.equal("glossaryTerms" in buildEditorAiReviewBatchRequest(request({ rows: state.rows, reviewMode: "grammar" })), false);
});

test("normalizeEditorAiReviewMode keeps the three AI Review modes", () => {
  assert.equal(normalizeEditorAiReviewMode("clarity"), "clarity");
  assert.equal(normalizeEditorAiReviewMode(" meaning "), "meaning");
  assert.equal(normalizeEditorAiReviewMode("other"), "grammar");
});

test("editorAiReviewContentFingerprint changes with the text, footnotes, and caption only", () => {
  const base = row("r1", "Uno", "Mot");
  const fingerprint = editorAiReviewContentFingerprint(base, "vi");

  assert.equal(typeof fingerprint, "string");
  assert.equal(editorAiReviewContentFingerprint({ ...base }, "vi"), fingerprint);
  assert.equal(editorAiReviewContentFingerprint({ ...base, fields: { es: "Otro", vi: "Mot" } }, "vi"), fingerprint);
  assert.notEqual(editorAiReviewContentFingerprint({ ...base, fields: { es: "Uno", vi: "Mot." } }, "vi"), fingerprint);
  assert.notEqual(editorAiReviewContentFingerprint({ ...base, imageCaptions: { vi: "Anh" } }, "vi"), fingerprint);
  // Moving text between sections is a change.
  assert.notEqual(
    editorAiReviewContentFingerprint({ ...base, fields: { vi: "" }, imageCaptions: { vi: "Mot" } }, "vi"),
    fingerprint,
  );
});
