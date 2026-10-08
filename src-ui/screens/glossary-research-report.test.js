import test from "node:test";
import assert from "node:assert/strict";

import { renderGlossaryResearchReportScreen, zipfRange } from "./glossary-research-report.js";
import { buildEntryDrafts } from "../app/glossary-research-report-flow.js";

function run() {
  return {
    meta: { term: "vanidoso", sourceLanguage: { code: "es", name: "Spanish" }, targetLanguage: { code: "vi", name: "Vietnamese" }, sourceMode: "samael", seed: 1, modelId: "m", spendingLimitUsd: 4 },
    frozen: { version: "v1", entries: [{ id: "e1", kind: "word", sourceTerms: ["vanidoso", "vanidosa"], generalNote: "", variants: [{ id: "v1", target: "ham hư vinh", note: "" }] }] },
    aggregate: { totals: { judges: 1, passagesSampled: 1, populationDistinct: 1, populationRows: 1, duplicateGroups: 0, occurrencesSampled: 1, sampleRequested: 1, votes: 1, agreement: { agreed: 1, compared: 1 } },
      entries: { e1: { occurrences: 1, passages: 1, variants: { v1: { occurrences: 1, passages: 1 } }, other: 0, unresolved: {}, failed: 0 } } },
    counting: { occurrences: [], judgments: {} },
    sample: { items: {} },
    proposal: { entries: [{ id: "e1", variants: [{ id: "v1" }] }], existingComparison: [{ existing: "phù phiếm", verdict: "left_out", reason: "too broad" }] },
  };
}

function screen(glossaryTerms, decision) {
  const report = { status: "ready", run: run(), expandedVariants: {}, showAllExamples: {} };
  report.entryDrafts = buildEntryDrafts(report.run, glossaryTerms);
  if (decision) report.entryDrafts.e1.decision = decision;
  return renderGlossaryResearchReportScreen({ glossaryResearchReport: report, offline: {} });
}

const current = [{ termId: "t1", sourceTerms: ["vanidoso"], targetTerms: ["phù phiếm"], targetVariantNotes: [""], notesToTranslators: "" }];

test("an entry not yet in the glossary has no switch and can be saved", () => {
  const html = screen([]);
  assert.doesNotMatch(html, /rr-segmented/);
  assert.doesNotMatch(html, /data-action="save-research-report"[^>]*disabled/);
});

test("an entry already in the glossary switches between the suggestion and the current entry", () => {
  const suggested = screen(current);
  assert.match(suggested, /Suggested update/);
  assert.match(suggested, /Current glossary entry/);
  assert.match(suggested, /ham hư vinh/);
  assert.doesNotMatch(suggested, /left out of the suggestion/);

  const kept = screen(current, "keep");
  assert.match(kept, /left out of the suggestion/);
  assert.match(kept, /Why: too broad/);
  assert.doesNotMatch(kept, /data-research-entry="e1:target:0"/);
  assert.match(kept, /data-action="save-research-report"[^>]*disabled/);
});

test("each chart's scale runs from a whole number below its values to just past the highest", () => {
  assert.deepEqual(zipfRange([2.28, 4.52, 3.48, 2.48]), { lo: 2, hi: 4.62 });
  // 4.94 would stop just short of 5, so the chart goes to 5 and labels it.
  assert.deepEqual(zipfRange([4.84, 3.04, 2.04, 3.56]), { lo: 1, hi: 5 });
  assert.deepEqual(zipfRange([0, 2.98, 3.57]), { lo: 0, hi: 4 });
  assert.deepEqual(zipfRange([3.1, 3.2]), { lo: 2, hi: 3.5 });
});
