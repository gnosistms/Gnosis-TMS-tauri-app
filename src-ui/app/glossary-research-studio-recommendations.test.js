import test from "node:test";
import assert from "node:assert/strict";
import { newStudioStudy, STUDIO_STEPS, studioStepNumber } from "./glossary-research-studio-workflow.js";
import { STUDIO_SKIP_PROMPTS, studioCanRecommendSkip, studioRecommendationInput, studioRecommendationKey,
  currentStudioRecommendation, recommendStudioStep, sourceSummaryMustBeSkipped } from "./glossary-research-studio-recommendations.js";

const study = (step = "4.3") => ({ ...newStudioStudy({ term: "ilustre", forms: ["ilustre", "ilustres"],
  sourceLanguage: { code: "es", name: "Spanish" }, targetLanguage: { code: "en", name: "English" } }, "advice"),
step, forms: [{ text: "ilustre" }, { text: "ilustres" }], model: { providerId: "anthropic", modelId: "test" } });
const tools = (answer) => ({ assertCurrent() {}, ask: async () => answer });

test("every skippable operation has a specific conservative prompt, with consecutive visible numbering", async () => {
  assert.deepEqual(Object.keys(STUDIO_SKIP_PROMPTS).sort(), [...STUDIO_STEPS.filter((s) => s.optional).map((s) => s.id), "4.4.4"].sort());
  for (const step of Object.keys(STUDIO_SKIP_PROMPTS)) {
    let question;
    const result = await recommendStudioStep(study(step), { ...tools(), ask: async (q) => { question = q; return { recommendation: "Skip", reason: "Covered already." }; } });
    assert.equal(result.recommendation, "Skip");
    assert(question.includes(STUDIO_SKIP_PROMPTS[step]));
    assert.match(question, /If uncertain.*output Run/);
    assert.match(question, /Do not perform the research/);
  }
  assert.equal(studioStepNumber("4.4.4"), "4.4.3");
  assert.equal(studioCanRecommendSkip("8"), false);
});

test("uncertainty, malformed recommendations and request errors conservatively recommend Run", async () => {
  for (const result of [null, {}, { recommendation: "Not sure", reason: "Unknown." }, { recommendation: "Skip" }, { recommendation: "skip", reason: "Maybe." }]) {
    const r = await recommendStudioStep(study(), tools(result));
    assert.equal(r.recommendation, "Run"); assert.equal(r.fallback, true);
  }
  const s = study(); const before = structuredClone(s);
  const r = await recommendStudioStep(s, { ...tools(), ask: async () => { throw new Error("Provider unavailable"); } });
  assert.equal(r.recommendation, "Run"); assert.equal(r.fallback, true);
  assert.deepEqual(s, before, "advice must not change approval, skip, step, or evidence");
  await assert.rejects(recommendStudioStep(s, { ...tools(), ask: async () => { throw new Error("Research paused."); } }), /Research paused/);
});

test("recommendations reuse unchanged compact inputs but change after meaningful edits", async () => {
  const s = study(); s.steps["4.1"] = { approved: { summary: "Simple adjective.", meanings: [{ definition: "Distinguished" }] } };
  const r = await recommendStudioStep(s, tools({ recommendation: "Skip", reason: "No productive components." }));
  s.skipRecommendations = { [s.step]: r };
  assert.equal(currentStudioRecommendation(s), r);
  assert.equal(await recommendStudioStep(s, { ask() { throw new Error("Should reuse"); } }), r);
  s.timing = { unrelated: true }; s.revision += 1;
  assert.equal(currentStudioRecommendation(s), r);
  s.steps["4.1"].approved.summary = "Formation unresolved.";
  assert.equal(currentStudioRecommendation(s), null);
  let refresh;
  await recommendStudioStep(s, { ...tools(), ask: async (_, input) => { refresh = input.refresh; return { recommendation: "Run", reason: "Check formation." }; } }, { refresh: true });
  assert.equal(typeof refresh, "string");
});

test("bounded preview excludes raw ledgers and preserves questions rather than claiming completeness", () => {
  const s = study("4.4.2");
  for (const id of ["4.1", "4.2", "4.4.1"]) s.steps[id] = { approved: {
    summary: "Relevant finding. ".repeat(1000), evidence: { raw: "PRIVATE_RAW_LEDGER".repeat(10000) },
    meanings: Array.from({ length: 50 }, () => ({ definition: "Definition ".repeat(500), grammar: "Adjective" })) } };
  s.forms = Array.from({ length: 100 }, (_, i) => ({ text: `variant-${i}` }));
  s.passages = Array.from({ length: 500 }, (_, i) => ({ id: `p${i}`, text: "Context ".repeat(10000), reference: { doc_id: `book${i}` }, occurrences: [{ surface: "ilustre", start: 200 }] }));
  const input = studioRecommendationInput(s); const json = JSON.stringify(input);
  assert.equal(input.forms.length, 20); assert.equal(input.totalForms, 100);
  assert.equal(input.examples.length, 4); assert.equal(input.totalParagraphs, 500);
  assert(input.reports.every((r) => r.meanings.length === 6 && r.meaningCount === 50));
  assert(json.length < 14000, json.length); assert(!json.includes("PRIVATE_RAW_LEDGER"));
  assert.match(input.previewLimit, /cannot establish absence/);
});

test("source summary is skipped only after both branches were explicitly approved as skipped", () => {
  const s = study("4.4.4");
  s.steps["4.4.1"] = { approved: { skipped: true }, status: "skipped" };
  s.steps["4.4.2"] = { value: { skipped: true } };
  assert.equal(sourceSummaryMustBeSkipped(s), false);
  s.steps["4.4.2"] = { approved: { skipped: true }, status: "skipped" };
  assert.equal(sourceSummaryMustBeSkipped(s), true);
  s.steps["4.4.2"].status = "stale";
  assert.equal(sourceSummaryMustBeSkipped(s), false);
});

test("forms recommendation ignores later evidence; source summary does not load paragraph evidence", () => {
  for (const step of ["2a", "4.4.4"]) {
    const s = study(step); const before = studioRecommendationKey(s);
    s.passages = [{ id: "p", text: "Later research", occurrences: [] }];
    assert.equal(studioRecommendationKey(s), before);
    s.passages = { _studioArtifact: "saved", length: 57 };
    assert.equal(studioRecommendationKey(s), before);
  }
});
