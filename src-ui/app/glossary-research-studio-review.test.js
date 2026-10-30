import test from "node:test";
import assert from "node:assert/strict";
import { studioStepNeedsReview } from "./glossary-research-studio-review.js";
import { newStudioStudy, deduplicatePassages, meaningTrialSignature, entryBatchSignature, stableSignature, buildStudioDraft, STUDIO_STEPS, STUDIO_DICTIONARY_REVIEW_VERSION } from "./glossary-research-studio-workflow.js";

function study() {
  const s = newStudioStudy({ term: "walk", sourceLanguage: { code: "en", name: "English" }, targetLanguage: { code: "vi", name: "Vietnamese" } }, "auto-review");
  s.forms = [{ text: "walk", selected: true }];
  s.meanings = [{ id: "m1", definition: "Move on foot" }];
  s.candidates = [{ id: "c1", text: "đi", meaningIds: ["m1"], selected: true, confirmed: true, retained: true }];
  s.passages = deduplicatePassages([{ id: "p", text: "I walk home." }], ["walk"], "en");
  s.assignments = s.passages.flatMap((p) => p.occurrences.map((o) => ({ paragraphId: p.id, occurrenceId: o.id, meaningId: "m1" })));
  return s;
}

test("steps that only report findings continue, while missing results and decisions stop", () => {
  const s = study();
  const finding = { definition: "A finding" };
  for (const [step, empty, found] of [
    ["4.1", { meanings: [], dictionaryVersion: STUDIO_DICTIONARY_REVIEW_VERSION }, { meanings: [finding], dictionaryVersion: STUDIO_DICTIONARY_REVIEW_VERSION }],
    ...["4.2", "4.4.2", "4.4.4"].map((step) => [step, { meanings: [] }, { meanings: [finding] }]),
    ["4.4.1", { meanings: [] }, { meanings: [finding], authorAssessments: [{ summary: "Chronology remains uncertain" }], evidence: { authors: [{ name: "Author A" }] } }],
    ["4.3", { parts: [] }, { parts: [{ text: "walk" }] }],
    ["5", { compounds: [] }, { compounds: [{ phrase: "walk home", meaningId: "m1", specialMeaning: true, explanation: "Special meaning", paragraphIds: ["p"] }] }],
    ["7", { decisions: [] }, { decisions: [{ spelling: "đi" }] }],
  ]) {
    assert.equal(studioStepNeedsReview(s, step, empty), false, `${step}: empty`);
    assert.equal(studioStepNeedsReview(s, step, found), false, `${step}: findings to read later`);
    assert.equal(studioStepNeedsReview(s, step, {}), true, `${step}: incomplete`);
  }
  assert.equal(studioStepNeedsReview(s, "3", { paragraphs: 3 }), false);
  assert.equal(studioStepNeedsReview(s, "3", { paragraphs: 0 }), true, "no research paragraphs");
  assert.equal(studioStepNeedsReview(s, "4.1", { meanings: [finding] }), true, "stale dictionary review");
  assert.equal(studioStepNeedsReview(s, "4.1", { meanings: [], dictionaryVersion: STUDIO_DICTIONARY_REVIEW_VERSION, evidence: { status: "unreachable" } }), true);
  assert.equal(studioStepNeedsReview(s, "4.1", { meanings: [], dictionaryVersion: STUDIO_DICTIONARY_REVIEW_VERSION, evidence: { status: "not_found" } }), false);
  assert.equal(studioStepNeedsReview(s, "2b", { entries: [] }), false);
  assert.equal(studioStepNeedsReview(s, "2b", { entries: [{ sourceTerms: ["walk"] }] }), true, "existing entries need a choice");
  assert.equal(studioStepNeedsReview(s, "2b", {}), true);
  s.relatedEntries = [{ termId: "old", sourceTerms: ["walk"] }];
  assert.equal(studioStepNeedsReview(s, "2b", { entries: [] }), true, "conflicting saved entry state requires review");
});

test("only qualifying split proposals need a choice", () => {
  const s = study();
  assert.equal(studioStepNeedsReview(s, "4.7", { proposals: [] }), false);
  const proposal = { forms: ["walk home"], meaningId: "m1" };
  assert.equal(studioStepNeedsReview(s, "4.7", { proposals: [proposal] }), true);
  assert.equal(studioStepNeedsReview(s, "4.7", { proposals: [{ ...proposal, forms: ["walk away"] }] }), false);
});

test("scope and human reviews never auto-advance, including empty choices and final save", () => {
  const s = study();
  for (const step of ["1", "2a", "4.5", "4.6", "6", "10a", "11", "12"]) {
    assert.equal(studioStepNeedsReview(s, step, { complete: true, forms: [], meanings: [], candidates: [], assignments: [] }), true, step);
  }
  assert.equal(studioStepNeedsReview(s, "11", { skipped: true }), true);
});

test("pending input, failures and unresolved artifact references cannot become empty results", () => {
  const s = study();
  for (const step of STUDIO_STEPS.map((item) => item.id)) {
    s.pendingDecision = { kind: "unmatched" };
    assert.equal(studioStepNeedsReview(s, step, { meanings: [], entries: [], paragraphs: 3 }), true);
    s.pendingDecision = null; s.error = "Request failed";
    assert.equal(studioStepNeedsReview(s, step, { meanings: [], entries: [], paragraphs: 3 }), true);
    s.error = "";
    assert.equal(studioStepNeedsReview(s, step, { pending: true }), true);
    if (step !== "10b") assert.equal(studioStepNeedsReview(s, step, { _studioArtifact: "unopened" }), true);
  }
});

test("successful tests advance only with current evidence and no repair report", () => {
  const s = study();
  s.tests["8:m1"] = { passed: true, signature: meaningTrialSignature(s, "m1"), rounds: 0 };
  s.tests["9:0"] = { phase: "9", passed: true, signature: stableSignature(buildStudioDraft(s)),
    batchSignature: entryBatchSignature(s, s.passages, s.assignments), choices: s.assignments };
  for (const step of ["8", "9"]) {
    assert.equal(studioStepNeedsReview(s, step, { complete: true }), false, step);
    s.rounds[`${step}:repair`] = 1;
    assert.equal(studioStepNeedsReview(s, step, { complete: true }), true);
    delete s.rounds[`${step}:repair`];
    s.reports.repair = { kind: "usage-notes", step, summary: "Changed note conditions" };
    assert.equal(studioStepNeedsReview(s, step, { complete: true }), true);
    delete s.reports.repair;
  }
  s.generalNote = "A revised selection condition";
  assert.equal(studioStepNeedsReview(s, "8", { complete: true }), true);
  assert.equal(studioStepNeedsReview(s, "9", { complete: true }), true);
});

test("collision checks continue only when the current glossary has no matching source form", () => {
  const s = study();
  assert.equal(studioStepNeedsReview(s, "10b", null, []), false);
  assert.equal(studioStepNeedsReview(s, "10b", null, [{ termId: "old", sourceTerms: ["walk"], targetTerms: ["đi"] }]), true);
});
