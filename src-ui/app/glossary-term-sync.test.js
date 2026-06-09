import test from "node:test";
import assert from "node:assert/strict";

import {
  applyGlossaryTermsStale,
  buildGlossaryTermFromDraft,
  ensureGlossaryTermReadyForEdit,
  findGlossaryTermById,
  loadGlossaryTermFromDisk,
  markGlossaryTermsStale,
  markVisibleGlossaryTermConfirmed,
  markVisibleGlossaryTermFailed,
  removeVisibleGlossaryTerm,
  replaceOptimisticGlossaryTerm,
  upsertVisibleGlossaryTerm,
} from "./glossary-term-sync.js";

test("applyGlossaryTermsStale marks changed terms stale without touching untouched terms", () => {
  const terms = [
    { termId: "term-1", freshness: "fresh", remotelyDeleted: false },
    { termId: "term-2", freshness: "fresh", remotelyDeleted: false },
  ];

  const result = applyGlossaryTermsStale(terms, {
    changedTermIds: ["term-2"],
  });

  assert.deepEqual(result, [
    { termId: "term-1", freshness: "fresh", remotelyDeleted: false },
    { termId: "term-2", freshness: "stale", remotelyDeleted: false },
  ]);
});

test("applyGlossaryTermsStale marks deleted terms as remotely deleted", () => {
  const terms = [
    { termId: "term-1", freshness: "fresh", remotelyDeleted: false },
    { termId: "term-2", freshness: "fresh", remotelyDeleted: false },
  ];

  const result = applyGlossaryTermsStale(terms, {
    deletedTermIds: ["term-1"],
  });

  assert.deepEqual(result, [
    { termId: "term-1", freshness: "stale", remotelyDeleted: true },
    { termId: "term-2", freshness: "fresh", remotelyDeleted: false },
  ]);
});

test("glossary term sync keeps the public adapter export surface stable", () => {
  assert.equal(typeof findGlossaryTermById, "function");
  assert.equal(typeof buildGlossaryTermFromDraft, "function");
  assert.equal(typeof upsertVisibleGlossaryTerm, "function");
  assert.equal(typeof replaceOptimisticGlossaryTerm, "function");
  assert.equal(typeof markVisibleGlossaryTermConfirmed, "function");
  assert.equal(typeof markVisibleGlossaryTermFailed, "function");
  assert.equal(typeof removeVisibleGlossaryTerm, "function");
  assert.equal(typeof applyGlossaryTermsStale, "function");
  assert.equal(typeof markGlossaryTermsStale, "function");
  assert.equal(typeof loadGlossaryTermFromDisk, "function");
  assert.equal(typeof ensureGlossaryTermReadyForEdit, "function");
});
