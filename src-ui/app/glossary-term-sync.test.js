import test from "node:test";
import assert from "node:assert/strict";

import { applyGlossaryTermsStale } from "./glossary-term-sync.js";

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
