import test from "node:test";
import assert from "node:assert/strict";

import { buildLogSections } from "../app/glossary-research-log-view.js";
import { renderResults, renderStageLine, stageIndex } from "./glossary-research-log-render.js";

const log = [
  { type: "heading", text: "Dictionary" }, { type: "fact", text: "DLE: found (2 senses)" }, { type: "fact", text: "1. adj. Lo más interior." },
  { type: "heading", text: "Word forms" }, { type: "fact", text: "Forms: fatal, fatales" },
];

test("while research runs, the last step is open and the earlier ones fold to a summary", () => {
  const html = renderResults(buildLogSections(log), { running: true });
  const [dictionary, forms] = html.split("<section").slice(1);
  assert.match(dictionary, /research-section__summary">1\. adj\. Lo más interior\./);
  assert.match(dictionary, /data-action="toggle-research-section:s1" aria-expanded="false"/);
  assert.doesNotMatch(dictionary, /research-section__body/);
  assert.match(forms, /is-current/);
  assert.match(forms, /data-step-current/);
  assert.match(forms, /research-section__body/);
  assert.doesNotMatch(forms, /toggle-research-section/);
});

test("a finished step opens to its final state", () => {
  const html = renderResults(buildLogSections(log), { running: false, openSections: { s1: true } });
  const [dictionary, forms] = html.split("<section").slice(1);
  assert.match(dictionary, /research-section__body/);
  assert.match(dictionary, /aria-expanded="true"/);
  assert.doesNotMatch(forms, /research-section__body/);
});

const request = (id, stage, extra = {}) => ({ type: "request", requestId: id, stage, purpose: "p", text: "SENT TEXT", instructions: "SENT RULES", ...extra });
const usage = (id) => ({ type: "usage", requestId: id, record: { status: "ok", seconds: 3, costUsd: 0.01 } });

test("a step with a readable view shows the view, not the conversation", () => {
  const steps = [
    { type: "heading", text: "Word forms" },
    request("r1", "forms"),
    { type: "thinking", requestId: "r1", text: "**Listing forms**\nthe forms" },
    { type: "answer-delta", requestId: "r1", text: '{"forms":[{"form":"íntimo","kind":"inflection","confidence":"high"}]}' },
    usage("r1"),
    { type: "heading", text: "Proposal" },
  ];
  const [forms] = renderResults(buildLogSections(steps), { running: false, openSections: { s1: true } }).split("<section").slice(1);
  assert.match(forms, /research-view--forms/);
  assert.match(forms, /íntimo/);
  assert.doesNotMatch(forms, /SENT TEXT|Listing forms|&quot;forms&quot;/, "no exchange, thinking or JSON");
});

test("a step without a view yet shows the conversation; a step still thinking shows no thinking, only that it thinks", () => {
  const steps = [
    { type: "heading", text: "Proposal" },
    request("r2", "original-note"),
    { type: "thinking", requestId: "r2", text: "**Wording the note**" },
    { type: "answer-delta", requestId: "r2", text: '{"note":"Traditional term"}' },
    usage("r2"),
    { type: "heading", text: "Counting" },
    request("r3", "counting"),
    { type: "thinking", requestId: "r3", text: "**Weighing the variants**\nreading the passage" },
  ];
  const html = renderResults(buildLogSections(steps), { running: true, openSections: { s1: true } });
  const [proposal, counting] = html.split("<section").slice(1);
  assert.match(proposal, /research-step__view--plain/);
  assert.match(proposal, /Traditional term/);
  assert.match(proposal, /What was sent/);
  assert.match(proposal, /How the AI got there \(1 step\)/, "finished: the thinking is folded");
  assert.doesNotMatch(counting, /data-live-thinking|Weighing the variants|reading the passage/, "the thinking is not shown (Hans, 2026-10-09)");
  assert.match(counting, /data-step-status/);
});

test("the stage line marks the stages done, the one in progress and those to come", () => {
  assert.equal(stageIndex("Candidate checks", "running"), 2);
  assert.equal(stageIndex("anything", "review"), 4);
  const html = renderStageLine({ stepLabel: "Candidate checks", runStatus: "running" });
  assert.equal((html.match(/research-steps__item--done/g) ?? []).length, 2);
  assert.match(html, /research-steps__item--current" aria-current="step">\s*<span class="research-steps__dot" aria-hidden="true"><\/span>\s*<span class="research-steps__label">Candidates/);
  assert.equal((html.match(/research-steps__item--todo/g) ?? []).length, 4);
});

test("a finished step shows its view without the AI's thinking", () => {
  const steps = [
    { type: "heading", text: "Candidate translations" },
    request("r4", "candidates"),
    { type: "thinking", requestId: "r4", text: "**Reading the origin**\nIt is a noun.\n\n**Grouping**\nTwo groups." },
    { type: "answer-delta", requestId: "r4", text: '{"senses":[{"senseId":"s1","sense":"divine","groups":[{"members":["Innermost"],"recommended":true,"note":"n","rationale":"r"}]}]}' },
    usage("r4"),
    { type: "heading", text: "Proposal" },
  ];
  const [candidates] = renderResults(buildLogSections(steps), { running: false, openSections: { s1: true } }).split("<section").slice(1);
  assert.match(candidates, /research-view--candidates/);
  assert.doesNotMatch(candidates, /How the AI got there|Reading the origin/);
});

test("a finished step that only repeats its line cannot be opened; its explanation shows on hover", () => {
  const steps = [{ type: "heading", text: "Rare translations" }, { type: "fact", text: "No chosen translation is rare." }, { type: "heading", text: "Summary" }];
  const [rare] = renderResults(buildLogSections(steps), { running: false, openSections: { s1: true } }).split("<section").slice(1);
  assert.doesNotMatch(rare, /toggle-research-section|research-section__body/);
  assert.match(rare, /data-tooltip="Do translations that are rare in everyday use need a note\?"/);
});

test("findings and answers keep their order of arrival", () => {
  const steps = [
    { type: "heading", text: "Candidate translations" },
    { type: "fact", text: "FOUND BEFORE the request." },
    request("r5", "candidates"),
    { type: "answer-delta", requestId: "r5", text: '{"senses":[{"senseId":"s1","sense":"divine","groups":[{"members":["Innermost"],"recommended":true,"note":"n","rationale":"r"}]}]}' },
    usage("r5"),
    { type: "fact", text: "FOUND AFTER the answer." },
    { type: "heading", text: "Proposal" },
  ];
  const [section] = renderResults(buildLogSections(steps), { running: false, openSections: { s1: true } }).split("<section").slice(1);
  const step = section.slice(section.indexOf("research-section__body"));
  const before = step.indexOf("FOUND BEFORE");
  const view = step.indexOf("research-view--candidates");
  const after = step.indexOf("FOUND AFTER");
  assert.ok(before >= 0 && view >= 0 && after >= 0);
  assert.ok(before < view && view < after, "fact, then the answer, then the later fact");
});

test("a finding and an AI answer appear in order of arrival, with no label on the answer", () => {
  const steps = [
    { type: "heading", text: "Where the term comes from" },
    { type: "fact", text: "The search site lists Libro among the books the author read." },
    request("r4", "sources"),
    { type: "answer-delta", requestId: "r4", text: '{"summary":"From M.","senses":[{"sense":"divine Being","inDictionary":false,"sourceBook":"Dioses Atómicos — M.","originalLanguage":"English","originalTerm":"Innermost"}]}' },
    usage("r4"),
    { type: "heading", text: "Proposal" },
  ];
  const [sources] = renderResults(buildLogSections(steps), { running: true, openSections: { s1: true } }).split("<section").slice(1);
  assert.doesNotMatch(sources, /The AI's answer/, "Hans, 2026-10-10: nearly everything shown is the AI's");
  assert.ok(sources.indexOf("The search site lists") < sources.indexOf("From M."), "the finding comes first");
  assert.match(sources, /Dioses Atómicos \(signed only “M\.”\)/);
});
