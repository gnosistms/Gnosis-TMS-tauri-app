import test from "node:test";
import assert from "node:assert/strict";
import { newStudioStudy } from "./glossary-research-studio-workflow.js";
import { budgetComparison, referenceForTranslationTests, testOmittedInterpretation } from "./glossary-research-studio-experiments.js";

function reference() {
  const s = newStudioStudy({ term: "tenebroso", seed: 7, sourceLanguage: { code: "es", name: "Spanish" }, targetLanguage: { code: "en", name: "English" } });
  s.status = "complete"; s.model = {}; s.forms = [{ text: "tenebroso", selected: true }];
  s.meanings = [{ id: "literal", definition: "Without light" }, { id: "symbolic", definition: "Psychological darkness" }];
  s.passages = [{ id: "normal", text: "tenebroso", occurrences: [{ id: "o", start: 0, end: 9 }] },
    { id: "late", text: "tenebroso", occurrences: [{ id: "o", start: 0, end: 9 }], recovered: true }];
  s.assignments = s.passages.map((p, i) => ({ paragraphId: p.id, occurrenceId: "o", meaningId: i ? "symbolic" : "literal" }));
  s.population = s.passages; s.candidates = [{ id: "dark", text: "dark", meaningIds: ["literal", "symbolic"], confirmed: true, selected: true }];
  s.comparisonStarts = { 8: { fields: { candidates: structuredClone(s.candidates), generalNote: "initial advice", tests: {} } } };
  s.steps["4.5"] = { approved: { meanings: s.meanings } };
  return s;
}

test("controlled comparison preserves its source and restores the entire reference after discovery misses", async () => {
  const source = reference(); const original = structuredClone(source);
  const copy = await budgetComparison(source, async (value) => value);
  assert.notEqual(copy.id, source.id); assert.equal(copy.passages.length, 1); assert.equal(copy.assignments.length, 0);
  assert.equal(copy.comparisonReference.paragraphCount, 2);
  copy.assignments = [{ ...source.assignments[0] }]; copy.meanings[1].unused = true;
  copy.steps["4.6"] = { value: { paragraphs: 1 } };
  referenceForTranslationTests(copy, copy.comparisonReference);
  assert.equal(copy.comparisonResults.assignment.paragraphIds.length, 1);
  assert.equal(copy.passages.length, 2); assert.deepEqual(copy.assignments, source.assignments);
  copy.passages[0].text = "new edit";
  assert.deepEqual(source, original);
});

test("omission audit builds guidance without the omitted definition or held-out paragraph and judges semantic impact", async () => {
  const source = reference(); let calls = 0;
  const result = await testOmittedInterpretation(source, { ...source, finalCandidates: source.candidates }, {
    ask: async (_q, data) => {
      if (++calls === 1) {
        assert(!JSON.stringify(data).includes("Psychological")); assert(!data.source);
        return { generalNote: "Use dark for lack of light", notes: [{ candidateId: "dark", note: "Dark" }] };
      }
      assert.equal(data.translation, "dark");
      return { severity: "acceptable", explanation: "Dark retains the metaphor", preservesImagery: true, preservesImplication: true };
    },
    run: async (_kind, payload) => {
      assert(!JSON.stringify(payload).includes("Psychological"));
      return { rows: [{ rowId: "1", translatedText: "dark" }] };
    },
  });
  assert.equal(result.verdict.severity, "acceptable"); assert.deepEqual(result.omittedMeaningIds, ["symbolic"]);
});
