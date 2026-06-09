import test from "node:test";
import assert from "node:assert/strict";

import {
  applyQaTermsStale,
  buildQaTermFromDraft,
  ensureQaTermReadyForEdit,
  findQaTermById,
  loadQaTermFromDisk,
  markQaTermsStale,
  markVisibleQaTermConfirmed,
  markVisibleQaTermFailed,
  removeVisibleQaTerm,
  replaceOptimisticQaTerm,
  upsertVisibleQaTerm,
} from "./qa-term-sync.js";

test("buildQaTermFromDraft builds QA text and notes fields from a draft", () => {
  const term = buildQaTermFromDraft(
    {
      termId: "term-1",
      text: "Use consistent capitalization.",
      notes: "Applies to headings.",
      sourceTerms: ["ignored glossary source"],
      targetTerms: ["ignored glossary target"],
    },
    {
      pendingMutation: "save",
      pendingError: "retry later",
      optimisticClientId: "client-term-1",
    },
  );

  assert.deepEqual(term, {
    termId: "term-1",
    text: "Use consistent capitalization.",
    notes: "Applies to headings.",
    pendingMutation: "save",
    pendingError: "retry later",
    optimisticClientId: "client-term-1",
  });
});

test("QA term sync keeps the public adapter export surface stable", () => {
  assert.equal(typeof findQaTermById, "function");
  assert.equal(typeof buildQaTermFromDraft, "function");
  assert.equal(typeof upsertVisibleQaTerm, "function");
  assert.equal(typeof replaceOptimisticQaTerm, "function");
  assert.equal(typeof markVisibleQaTermConfirmed, "function");
  assert.equal(typeof markVisibleQaTermFailed, "function");
  assert.equal(typeof removeVisibleQaTerm, "function");
  assert.equal(typeof applyQaTermsStale, "function");
  assert.equal(typeof markQaTermsStale, "function");
  assert.equal(typeof loadQaTermFromDisk, "function");
  assert.equal(typeof ensureQaTermReadyForEdit, "function");
});
