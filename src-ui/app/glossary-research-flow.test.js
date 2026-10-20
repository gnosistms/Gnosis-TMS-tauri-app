import test from "node:test";
import assert from "node:assert/strict";

import { interruptedRunMeta, researchStagesWithSpellings, toggleResearchSpelling } from "./glossary-research-flow.js";
import { state } from "./state.js";
import { createGlossaryResearchState } from "./glossary-research-state.js";

test("continuing approved spellings preserves the run and cost but invalidates empty search evidence", () => {
  const stages = { meta: { runId: "original-run", term: "Vornak", variants: ["Vornake"], settings: { term: "Vornak", variants: ["Vornake"], researchProcedure: "compact" } },
    spellingChoice: { suggestions: [{ form: "Vornag" }, { form: "Vornar" }] }, forms: { searched: [] }, sample: { measuredIds: [] }, proposal: { entries: [] }, usage: [{ inputTokens: 100 }], log: [{ text: "past work" }] };
  const next = researchStagesWithSpellings(stages, ["Vornag", "Vornag"]);
  assert.equal(next.meta.runId, "original-run"); assert.equal(next.meta.term, "Vornak");
  assert.deepEqual(next.meta.variants, ["Vornake", "Vornag"]);
  assert.deepEqual(next.meta.settings.variants, ["Vornake", "Vornag"]);
  assert.equal(next.forms, null); assert.equal(next.sample, null); assert.equal(next.proposal, null); assert.equal(next.spellingChoice, null);
  assert.deepEqual(next.usage, stages.usage); assert.deepEqual(next.log, stages.log);
  assert.deepEqual(stages.meta.variants, ["Vornake"], "the saved source data is not mutated");
  assert.throws(() => researchStagesWithSpellings(stages, []), /Select at least one/);
  assert.throws(() => researchStagesWithSpellings(stages, ["unknown"]), /Select at least one/);
});

test("spelling checkboxes update only the user's pending choice", () => {
  const before = state.glossaryResearch;
  try {
    state.glossaryResearch = { ...createGlossaryResearchState(), runStatus: "spellings", spellingSuggestions: [{ form: "Vornag" }, { form: "Vornar" }], spellingTicked: [true, false], spellingError: "Select one" };
    let renders = 0; const render = () => { renders += 1; };
    toggleResearchSpelling(render, 0); toggleResearchSpelling(render, 1); toggleResearchSpelling(render, -1);
    assert.deepEqual(state.glossaryResearch.spellingTicked, [false, true]);
    assert.equal(state.glossaryResearch.spellingError, ""); assert.equal(renders, 2);
    assert.deepEqual(state.glossaryResearch.variants, [], "checkboxes alone do not add spellings");
  } finally { state.glossaryResearch = before; }
});

test("a run still marked running that this app is not running is marked stopped", () => {
  const meta = { runId: "2026-10-09T11-19-41_cohabitar", term: "Cohabitar", status: "running" };
  const fixed = interruptedRunMeta(meta, null);
  assert.equal(fixed.status, "stopped");
  assert.equal(fixed.interruptedDuring, "running");
  assert.match(fixed.error, /closed or reloaded/);
  assert.equal(meta.status, "running", "the record read is not changed in place");
  assert.equal(interruptedRunMeta({ ...meta, status: "counting" }).interruptedDuring, "counting", "a resume goes on counting");
  assert.equal(interruptedRunMeta(meta, meta.runId), null, "the run this app is running is left alone");
  for (const status of ["review", "done", "stopped", "failed"]) assert.equal(interruptedRunMeta({ ...meta, status }), null, status);
  assert.equal(interruptedRunMeta(null), null);
});
