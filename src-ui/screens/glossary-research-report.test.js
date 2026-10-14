import test from "node:test";
import assert from "node:assert/strict";

import { renderGlossaryResearchReportScreen, zipfRange } from "./glossary-research-report.js";
import { buildEntryDrafts, unresolvedConflicts } from "../app/glossary-research-report-flow.js";

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

test("translations chosen in under 2% of the votes come unticked, marked rarely or never chosen", () => {
  const r = run();
  r.frozen.entries[0].variants = [
    { id: "v1", target: "hư vinh", note: "" }, { id: "v2", target: "thói tự ngưỡng mộ", note: "" }, { id: "v3", target: "sự vô nghĩa", note: "" },
  ];
  r.aggregate.entries.e1 = { occurrences: 234, passages: 100, variants: { v1: { occurrences: 230, passages: 99 }, v2: { occurrences: 4, passages: 3 } }, other: 0, unresolved: {}, failed: 0 };
  const drafts = buildEntryDrafts(r, []);
  assert.deepEqual(drafts.e1.variants.map((v) => [v.target, v.include]), [["hư vinh", true], ["thói tự ngưỡng mộ", false], ["sự vô nghĩa", false]]);
  const html = renderGlossaryResearchReportScreen({ glossaryResearchReport: { status: "ready", run: r, entryDrafts: drafts, expandedVariants: {}, showAllExamples: {} }, offline: {} });
  assert.match(html, /rarely chosen/);
  assert.match(html, /never chosen/);
});

test("a split entry becomes two drafts: the larger updates the existing entry and keeps its unstudied forms", () => {
  const r = run();
  r.frozen.entries[0] = { id: "e1", kind: "word", sourceTerms: ["vanidad", "vanidades"], generalNote: "", variants: [
    { id: "v1", target: "hư vinh", note: "" }, { id: "v2", target: "những thứ phù phiếm", note: "" }, { id: "v3", target: "những thứ phù hoa", note: "" },
  ] };
  const occurrences = [];
  const judgments = {};
  const add = (surface, variantId, n) => {
    for (let i = 0; i < n; i += 1) {
      const occId = `${surface}${occurrences.length}`;
      occurrences.push({ occId, entryId: "e1", itemId: `i${occurrences.length}`, surface });
      judgments[occId] = { status: "selected", variantId };
    }
  };
  add("vanidad", "v1", 30);
  add("vanidades", "v2", 8);
  add("vanidades", "v3", 4);
  r.counting = { occurrences, judgments };
  const existing = [{ termId: "t1", sourceTerms: ["vanidad", "vanidades", "vano", "vanos"], targetTerms: ["phù phiếm"], targetVariantNotes: [""], notesToTranslators: "" }];
  const drafts = Object.values(buildEntryDrafts(r, existing));
  assert.deepEqual(drafts.map((d) => [d.sourceTerms, d.decision, d.variants.map((v) => v.target)]), [
    [["vanidad"], "update", ["hư vinh"]],
    [["vanidades"], "add", ["những thứ phù phiếm", "những thứ phù hoa"]],
  ]);
  assert.deepEqual(drafts[0].keepForms, ["vano", "vanos"]);
  const html = renderGlossaryResearchReportScreen({ glossaryResearchReport: { status: "ready", run: r, entryDrafts: Object.fromEntries(drafts.map((d) => [d.id, d])), expandedVariants: {}, showAllExamples: {} }, offline: {} });
  assert.match(html, /A separate entry:<\/span> <strong>vanidades<\/strong> mostly took other translations in the sample than <strong>vanidad<\/strong>, which have their own entry\./);
});

function consistencyRun() {
  const r = run();
  r.frozen.entries[0].variants = [
    { id: "v1", target: "world", note: "Default." }, { id: "v2", target: "planet", note: "A physical planet." }, { id: "v3", target: "orb", note: "" },
  ];
  r.aggregate.entries.e1 = { occurrences: 100, passages: 80, variants: { v1: { occurrences: 60, passages: 50 }, v2: { occurrences: 30, passages: 25 }, v3: { occurrences: 10, passages: 9 } }, other: 0, unresolved: {}, failed: 0 };
  r.counting = { occurrences: [{ occId: "o1.1", entryId: "e1", itemId: "p1", sentenceStart: 0, sentenceEnd: 22, surface: "mundo" }], judgments: {} };
  r.sample = { items: { p1: { itemId: "p1", text: "En otros mundos viven." } } };
  r.consistency = {
    flips: [{ occId: "o1.1", variantIds: ["v1", "v2"], choices: { v1: 3, v2: 2 }, translations: { v1: "In other worlds they live.", v2: "On other planets they live." }, reason: "planets are physical; worlds may be spiritual" }],
    standardised: [{ entryId: "e1", keep: "v1", variantIds: ["v1", "v3"], meanings: ["universe"] }],
    conflicts: [{ entryId: "e1", kind: "meaning", variantIds: ["v1", "v2"], occIds: ["o1.1"] }],
    dropped: ["v3"], narrowed: [],
  };
  return r;
}

test("the consistency test: a translation no meaning uses comes unticked; a meaning-changing flip blocks saving until settled", () => {
  const r = consistencyRun();
  const drafts = buildEntryDrafts(r, []);
  const variants = Object.fromEntries(drafts.e1.variants.map((v) => [v.target, v]));
  assert.equal(variants.orb.include, false);
  assert.match(variants.orb.consistency, /Removed by the consistency test: no meaning uses it any more; the translator standardised on “world”/);
  assert.equal(variants.world.include, true);
  assert.equal(drafts.e1.conflicts.length, 1);
  assert.equal(unresolvedConflicts(drafts.e1).length, 1);
  const html = renderGlossaryResearchReportScreen({ glossaryResearchReport: { status: "ready", run: r, entryDrafts: drafts, expandedVariants: {}, showAllExamples: {} }, offline: {} });
  assert.match(html, /Your decision is needed before saving[\s\S]*“world” and “planet”[\s\S]*changes the meaning/);
  assert.match(html, /En otros mundos viven\.[\s\S]*<strong>world<\/strong> \(3×\): In other worlds they live\.[\s\S]*<strong>planet<\/strong> \(2×\): On other planets they live\./);
  assert.match(html, /data-action="retest-research-conflict:e1:0"/);
  assert.match(html, /data-action="save-research-report"[^>]*disabled/);
  // Unticking all but one settles it.
  drafts.e1.variants.find((v) => v.target === "planet").include = false;
  assert.equal(unresolvedConflicts(drafts.e1).length, 0);
  // Or a test again that finds the translator keeps to one choice.
  drafts.e1.variants.find((v) => v.target === "planet").include = true;
  drafts.e1.conflicts[0].retest = { status: "consistent" };
  assert.equal(unresolvedConflicts(drafts.e1).length, 0);
  drafts.e1.conflicts[0].retest = { status: "flips", flips: 1, of: 1 };
  assert.equal(unresolvedConflicts(drafts.e1).length, 1);
});

test("the heading lists the forms used in the sample with their uses; the unused ones fold away", () => {
  const r = run();
  r.frozen.entries[0] = { id: "e1", kind: "word", sourceTerms: ["regenerar", "regenera", "regeneramos", "regenerasteis"], generalNote: "", variants: [{ id: "v1", target: "regenerate", note: "" }] };
  r.counting = { occurrences: [
    ...Array.from({ length: 3 }, (_, i) => ({ occId: `a${i}`, entryId: "e1", itemId: `i${i}`, surface: "regenerar" })),
    { occId: "b0", entryId: "e1", itemId: "j0", surface: "regenera" },
  ], judgments: {} };
  // The spelling step found "regeneramos" in the texts, not "regenerasteis".
  r.forms = { searched: ["regenerar", "regenera", "regeneramos"] };
  r.meta.term = "Regenerar";
  const drafts = buildEntryDrafts(r, []);
  assert.deepEqual(drafts.e1.sourceTerms, ["regenerar", "regenera", "regeneramos"], "only the forms found in the texts are saved");
  assert.deepEqual(drafts.e1.notInTexts, ["regenerasteis"]);
  const html = renderGlossaryResearchReportScreen({ glossaryResearchReport: { status: "ready", run: r, entryDrafts: drafts, expandedVariants: {}, showAllExamples: {} }, offline: {} });
  assert.match(html, /Forms in this entry, with their uses in the sample:<\/span> regenerar 3 · regenera 1</);
  assert.match(html, /<summary>and 1 form in the texts but not in the sample<\/summary>[\s\S]*regeneramos/);
  assert.doesNotMatch(html, /regenerasteis/, "forms never found in the texts are not listed (Hans, 2026-10-12)");
});
