import test from "node:test";
import assert from "node:assert/strict";

import { buildLogSections } from "../app/glossary-research-log-view.js";
import { renderResults, renderStageLine, stageIndex } from "./glossary-research-log-render.js";

const log = [
  { type: "heading", text: "Dictionary" }, { type: "fact", text: "DLE: found (2 senses)" },
  { type: "heading", text: "Word forms" }, { type: "fact", text: "Forms: fatal, fatales" },
];

test("while research runs, the last step is open and the earlier ones fold to a summary", () => {
  const html = renderResults(buildLogSections(log), { running: true });
  const [dictionary, forms] = html.split("<section").slice(1);
  assert.match(dictionary, /research-section__summary">DLE: found \(2 senses\)/);
  assert.match(dictionary, /data-action="toggle-research-section:s1"[^>]*>details ›/);
  assert.doesNotMatch(dictionary, /research-section__body/);
  assert.match(forms, /is-current/);
  assert.match(forms, /research-section__body/);
  assert.doesNotMatch(forms, /toggle-research-section/);
});

test("details unfolds a finished step", () => {
  const html = renderResults(buildLogSections(log), { running: false, openSections: { s1: true } });
  const [dictionary, forms] = html.split("<section").slice(1);
  assert.match(dictionary, /research-section__body/);
  assert.match(dictionary, />hide</);
  assert.doesNotMatch(forms, /research-section__body/);
});

test("the stage line marks the stages done, the one in progress and those to come", () => {
  assert.equal(stageIndex("Candidate checks", "running"), 2);
  assert.equal(stageIndex("anything", "review"), 4);
  const html = renderStageLine({ stepLabel: "Candidate checks", runStatus: "running" });
  assert.equal((html.match(/research-steps__item--done/g) ?? []).length, 2);
  assert.match(html, /research-steps__item--current" aria-current="step">\s*<span class="research-steps__dot" aria-hidden="true"><\/span>\s*<span class="research-steps__label">Candidates/);
  assert.equal((html.match(/research-steps__item--todo/g) ?? []).length, 4);
});
