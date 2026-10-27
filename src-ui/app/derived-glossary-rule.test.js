import test from "node:test";
import assert from "node:assert/strict";

import {
  derivedGlossaryUnavailableReason,
  derivedGlossaryUsageKindForPair,
  resolveDerivedGlossaryPivotLanguage,
} from "./derived-glossary-rule.js";

const EN = { code: "en", name: "English", role: "source" };
const ES = { code: "es", name: "Spanish", role: "target" };
const ES_2 = { code: "es-x-2", baseCode: "es", name: "Spanish 2", role: "target" };
const VI = { code: "vi", name: "Vietnamese", role: "target" };

function esViGlossary() {
  return {
    sourceLanguage: { code: "es" },
    targetLanguage: { code: "vi" },
    matcherModel: {},
    terms: [
      { lifecycleState: "active", sourceTerms: ["luz"], targetTerms: ["ánh sáng"] },
    ],
  };
}

function chapter(languages, glossary = esViGlossary()) {
  return { chapterId: "chapter-1", projectId: "project-1", languages, glossary };
}

test("resolveDerivedGlossaryPivotLanguage finds the chapter column matching the glossary source by base code", () => {
  assert.equal(resolveDerivedGlossaryPivotLanguage(chapter([EN, VI])), null);
  assert.equal(resolveDerivedGlossaryPivotLanguage(chapter([EN, ES, VI])), ES);
  assert.equal(resolveDerivedGlossaryPivotLanguage(chapter([EN, ES_2, VI])), ES_2);
  assert.equal(resolveDerivedGlossaryPivotLanguage(chapter([EN, ES, VI], null)), null);
  assert.equal(resolveDerivedGlossaryPivotLanguage(null), null);
});

test("derivedGlossaryUsageKindForPair applies the derived-glossary language rule", () => {
  // Pair targets the glossary target and the source IS the glossary source.
  assert.equal(derivedGlossaryUsageKindForPair(chapter([ES, VI]), ES, VI), "direct");
  // Source differs from the glossary source and a pivot column exists.
  assert.equal(derivedGlossaryUsageKindForPair(chapter([EN, ES, VI]), EN, VI), "derived");
  assert.equal(derivedGlossaryUsageKindForPair(chapter([EN, ES_2, VI]), EN, VI), "derived");
  // No pivot column: the glossary cannot serve this pair at all.
  assert.equal(derivedGlossaryUsageKindForPair(chapter([EN, VI]), EN, VI), "none");
  // Pair does not target the glossary target.
  assert.equal(derivedGlossaryUsageKindForPair(chapter([EN, ES, VI]), EN, ES), "none");
  // No glossary linked.
  assert.equal(derivedGlossaryUsageKindForPair(chapter([EN, ES, VI], null), EN, VI), "none");
});

test("derivedGlossaryUnavailableReason names the missing pivot column and stays silent otherwise", () => {
  const glossary = { ...esViGlossary(), title: "Gnosis ES-VI", sourceLanguage: { code: "es", name: "Spanish" } };
  assert.equal(
    derivedGlossaryUnavailableReason(chapter([EN, VI], glossary), EN, VI),
    "Gnosis ES-VI won't be used for Vietnamese: this file has no Spanish column to pivot through.",
  );
  assert.equal(derivedGlossaryUnavailableReason(chapter([EN, ES, VI], glossary), EN, VI), "");
  assert.equal(derivedGlossaryUnavailableReason(chapter([ES, VI], glossary), ES, VI), "");
  assert.equal(derivedGlossaryUnavailableReason(chapter([EN, VI], glossary), EN, ES), "");
  assert.equal(derivedGlossaryUnavailableReason(chapter([EN, VI], null), EN, VI), "");
});
