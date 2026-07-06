import test from "node:test";
import assert from "node:assert/strict";

import { buildEditorAiReviewBatchRequest } from "./editor-ai-review-request.js";

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
  assert.deepEqual(request.glossaryHints, []);
  assert.deepEqual(request.contextBefore, []);
  assert.deepEqual(request.contextAfter, []);
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
