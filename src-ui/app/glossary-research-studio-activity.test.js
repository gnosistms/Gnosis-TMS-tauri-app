import test from "node:test";
import assert from "node:assert/strict";
import { createStudioActivity, studioActivityItems, summarizeStudioActivity } from "./glossary-research-studio-activity.js";

test("parallel work preserves sibling results, planned future work and a paused branch", () => {
  const study = { step: "4.6" }; let current = true;
  const activity = createStudioActivity(study, () => {}, () => current);
  activity.plan([{ id: "translations", label: "Bilingual examples", children: [
    { id: "first", label: "First batch" }, { id: "second", label: "Second batch" }, { id: "third", label: "Third batch" },
  ] }]);
  activity.start(["translations", "first", "call"], "Translate first batch");
  activity.start(["translations", "second", "call"], "Translate second batch");
  activity.done(["translations", "second", "call"], { rows: [{ translatedText: "Second result" }] });
  // Navigation revokes publication before cancel reaches the owned operation.
  current = false; activity.pause();
  activity.done(["translations", "first", "call"], { summary: "Late result" });
  const [first, second, third] = study.activitySteps["4.6"].items[0].children;
  assert.equal(first.children[0].status, "paused");
  assert.match(second.children[0].result, /Second result/);
  assert.equal(second.children[0].status, "complete");
  assert.equal(third.status, "waiting");
  assert(!JSON.stringify(study).includes("Late result"));
  assert.deepEqual(studioActivityItems(JSON.parse(JSON.stringify(study))), study.activitySteps["4.6"].items);
});

test("legacy bibliography renders actual saved authors and findings without mutating evidence", () => {
  const study = { step: "4.4.1", steps: { "4.4.1": { value: { summary: "Parallel vocabulary does not establish borrowing.", meanings: [{ definition: "Harmful" }], evidence: {
    authors: [{ author: "An author", verifiedMentions: null, passages: [{ text: "Witness" }] }],
    findings: [{ summary: "Publication date remains uncertain.", meanings: [{ definition: "Harmful" }] }], original: { summary: "No verified original term." },
  } } } } };
  const original = structuredClone(study);
  const items = studioActivityItems(study);
  assert.equal(items.length, 6);
  assert.equal(items.find((n) => n.id === "authors").children[0].result, "Unresolved mention count; 1 sampled source paragraphs.");
  assert.match(items.find((n) => n.id === "comparisons").children[0].result, /Publication date remains uncertain/);
  assert.match(items.find((n) => n.id === "consolidate").result, /does not establish borrowing/);
  assert.deepEqual(study, original);
});

test("activity summaries are bounded source-derived results rather than prompts or whole receipts", () => {
  const summary = summarizeStudioActivity({ summary: "A finding. ".repeat(600), prompt: "Never show model instructions", meanings: [{ definition: "A real definition" }] });
  assert(summary.length <= 1801);
  assert(!summary.includes("Never show"));
  assert.match(summarizeStudioActivity({ judgments: [{ genuine: true }, { genuine: false }, { genuine: null }] }), /1 genuine mentions; 1 unresolved; 3 checked/);
});

test("an obsolete tracker cannot pause or overwrite a resumed tracker or an auxiliary lookup", () => {
  const study = { step: "8" };
  const old = createStudioActivity(study, () => {}, () => true);
  old.plan([{ id: "test", label: "Test meaning" }]); old.start(["test"], "Test meaning");
  const resumed = createStudioActivity(study, () => {}, () => true);
  resumed.start(["test"], "Resumed meaning test");
  old.pause(); old.done(["test"], { summary: "Obsolete result" });
  assert.equal(study.activitySteps["8"].items[0].status, "running");
  assert.equal(study.activitySteps["8"].items[0].label, "Resumed meaning test");
  const lookup = { ...study };
  const auxiliary = createStudioActivity(lookup, () => {}, () => true);
  auxiliary.start(["context"], "Load source context");
  auxiliary.done(["context"], { summary: "Wider context" });
  assert.equal(study.activitySteps["8"].items.length, 1);
  resumed.done(["test"], { summary: "Current result" });
  assert.equal(study.activitySteps["8"].items[0].result, "Current result");
});
