import test from "node:test";
import assert from "node:assert/strict";
import { researchChangesForDraft } from "./glossary-research-studio-editor-bridge.js";

test("editing a researched source in the term editor cannot remove its abandoned variant from an old entry", () => {
  const origin = { changes: [{ termId: "old", expected: { sourceTerms: ["walk", "walked", "walking"] }, sourceTerms: ["walking"] }] };
  assert.deepEqual(researchChangesForDraft(origin, ["walk"]).map((c) => c.sourceTerms), [["walked", "walking"]]);
  assert.deepEqual(researchChangesForDraft(origin, ["new word"]), []);
  assert.deepEqual(origin.changes[0].sourceTerms, ["walking"]);
});


test("editing research capitalization preserves staged removals and abandoned variants remain safe", () => {
  const origin = { scope: { sourceLanguage: { code: "es" } }, changes: [{ termId: "old",
    expected: { sourceTerms: ["Hooltampanas", "Other"] }, sourceTerms: ["Other"] }] };
  assert.deepEqual(researchChangesForDraft(origin, ["hooltampanas"])[0].sourceTerms, ["Other"]);
  assert.deepEqual(researchChangesForDraft(origin, ["another word"]), []);
});
