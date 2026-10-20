import test from "node:test";
import assert from "node:assert/strict";

import { reviewIntro } from "./glossary-research-modal.js";

test("one term: the review text speaks of its translations, not a list of terms", () => {
  const text = reviewIntro([{ sourceTerms: ["vanidad", "vanidades"] }], "vanidad");
  assert.match(text, /^Below are possible translations of “vanidad”\./);
  assert.doesNotMatch(text, /related/);
});

test("several terms: the review text names the term and counts the related ones", () => {
  const entries = [{ sourceTerms: ["ultrasensible"] }, { sourceTerms: ["suprasensible"] }, { sourceTerms: ["extrasensorial"] }];
  assert.match(reviewIntro(entries, "ultrasensible"), /^Below are “ultrasensible” and 2 related terms, each with its possible translations\./);
  assert.match(reviewIntro(entries.slice(0, 2), "ultrasensible"), /and 1 related term,/);
});
