import test from "node:test";
import assert from "node:assert/strict";

globalThis.document = globalThis.document ?? { querySelector: () => null, querySelectorAll: () => [] };
globalThis.window = globalThis.window ?? {};

const { savedMark, renderGlossaryResearchModal } = await import("./glossary-research-modal.js");
const { createGlossaryResearchState } = await import("../app/glossary-research-state.js");

test("new runs default to focused research and offer the full diagnostic route under Advanced", () => {
  const research = createGlossaryResearchState();
  assert.equal(research.researchProcedure, "compact");
  assert.equal(research.sampleSize, 40);
  research.isOpen = true; research.advancedOpen = true;
  const state = { glossaryResearch: research, glossaryEditor: { sourceLanguage: { code: "es" }, targetLanguage: { code: "vi" } }, projects: [] };
  const html = renderGlossaryResearchModal(state);
  assert.match(html, /data-research-field="researchProcedure"/);
  assert.match(html, /value="compact" selected/);
  assert.match(html, /Full diagnostic research/);
  research.researchProcedure = "full";
  assert.match(renderGlossaryResearchModal(state), /value="full" selected/);
});

test("past research saved to the glossary is marked, with when and what on hover", () => {
  assert.equal(savedMark({ status: "done" }), "");
  const html = savedMark({ status: "done", savedToGlossary: { at: "2026-10-12T09:30:00.000Z", entries: [{ sourceTerms: ["regenerar", "regenera"] }, { sourceTerms: ["regenerarse"] }] } });
  assert.match(html, /✓ saved/);
  assert.match(html, /Saved to the glossary on 2026-10-12: regenerar, regenera; regenerarse\./);
});

test("the spelling-choice step uses checked recommendations, unchecked alternatives, secondary Cancel and primary Continue", () => {
  const research = { ...createGlossaryResearchState(), isOpen: true, step: "run", runStatus: "spellings", term: "Vornak", stageLabel: "Word forms", spent: 0, limit: 4,
    spellingSuggestions: [{ form: "Vornag", rows: 2, recommended: true, reason: "Source definition matches." }, { form: "Vornar", rows: 8, recommended: false, reason: "May be another word." }], spellingTicked: [true, false] };
  const state = { glossaryResearch: research, glossaryEditor: { sourceLanguage: { code: "es" }, targetLanguage: { code: "en", name: "English" } } };
  const html = renderGlossaryResearchModal(state);
  assert.match(html, /toggle-research-spelling:0[^>]*checked/);
  assert.doesNotMatch(html, /toggle-research-spelling:1[^>]*checked/);
  assert.match(html, /Recommended\. Source definition matches/);
  assert.match(html, /button--secondary[^>]*data-action="close-glossary-research"[\s\S]*Cancel/);
  assert.match(html, /button--primary[^>]*data-action="continue-research-spellings"/);
  assert.doesNotMatch(html, /research-stopped|>Resume</);
  research.spellingTicked = [false, false];
  assert.match(renderGlossaryResearchModal(state), /data-action="continue-research-spellings"[^>]*disabled/);
});
