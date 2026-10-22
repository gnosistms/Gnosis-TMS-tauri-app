import test from "node:test";
import assert from "node:assert/strict";
import { applyUsageNoteRepairs, recordUsageNoteRepair } from "./glossary-research-studio-notes.js";
import { newStudioStudy, buildStudioDraft, clearStudioDependents } from "./glossary-research-studio-workflow.js";

function study() {
  const s = newStudioStudy({ term: "word", sourceLanguage: { code: "es" }, targetLanguage: { code: "en" } }, "notes");
  s.forms = [{ text: "word" }]; s.meanings = [{ id: "m" }];
  s.candidates = [{ id: "c", text: "target", note: "An obsolete exception.", meaningIds: ["m"], confirmed: true },
    { id: "duplicate", text: "target", note: "Another obsolete essay.", meaningIds: ["m"], confirmed: true }];
  return s;
}

test("note repairs replace all records of a target without clipping an accuracy-critical longer rule", () => {
  const s = study();
  const necessary = "Use this form only when the source explicitly names an inherited office, never merely because a person's family is prominent. Preserve the distinction between the hereditary office holder and the elected representative, even when their responsibilities overlap in the paragraph.";
  const repair = { notes: [{ candidateId: "c", note: necessary,
    longNoteReason: "Otherwise the elected representative is incorrectly given an inherited office." }],
    researchSummary: "The complete source comparison supports a necessary referent distinction." };
  applyUsageNoteRepairs(s, s.candidates, repair.notes);
  recordUsageNoteRepair(s, "8:m:1", "8", repair);
  assert(s.candidates.every((c) => c.note === necessary));
  const report = s.reports["8:m:1:usage-notes"];
  assert.equal(report.candidates[0].longNoteReason, repair.notes[0].longNoteReason);
  assert.equal(report.summary, repair.researchSummary);
  const draft = buildStudioDraft(s);
  assert.deepEqual(draft.targetVariantNotes, [necessary]);
  assert(!JSON.stringify(draft).includes(repair.researchSummary));
  assert(!JSON.stringify(draft).includes(repair.notes[0].longNoteReason));
});

test("invalid note updates leave every existing note intact", () => {
  const s = study(); const before = structuredClone(s.candidates);
  assert.throws(() => applyUsageNoteRepairs(s, s.candidates, [{ candidateId: "c", note: "New rule" },
    { candidateId: "missing", note: "Unknown" }]), /unknown candidate/);
  assert.deepEqual(s.candidates, before);
});


test("revising focused guidance clears dependent entry-repair reports without erasing focused research", () => {
  const s = study();
  s.reports = { "8:m:1:usage-notes": { kind: "usage-notes", step: "8", summary: "Focused evidence" },
    "9:1:0:usage-notes": { kind: "usage-notes", step: "9", summary: "Dependent entry evidence" } };
  clearStudioDependents(s, "8");
  assert.equal(s.reports["8:m:1:usage-notes"].summary, "Focused evidence");
  assert.equal(s.reports["9:1:0:usage-notes"], undefined);
});
