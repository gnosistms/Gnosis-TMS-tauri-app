import test from "node:test";
import assert from "node:assert/strict";
import { createStudioActivity, studioActivityItems, studioReviewOutcomes, summarizeStudioActivity } from "./glossary-research-studio-activity.js";
import { studioResultPresentation } from "./glossary-research-studio-result.js";

test("dictionary receipts identify a fallback edition without concealing genuine retrieval failures", () => {
  assert.equal(summarizeStudioActivity({ status: "found", language: "grc", edition: "en" }), "Looked up in the English Wiktionary edition.\nSource status: found.");
  assert.match(summarizeStudioActivity({ status: "unreachable", language: "grc", edition: "en" }), /Source status: unreachable\./u);
  assert.equal(summarizeStudioActivity({ status: "found", language: "fr", edition: "fr" }), "Source status: found.");
});

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

test("translation receipts preview only the count and expand to every translated paragraph", () => {
  const rows = Array.from({ length: 15 }, (_, i) => ({ rowId: String(i + 1), translatedText: `Đáp: translated paragraph ${i + 1}. ${"Long text. ".repeat(60)}` }));
  const summary = summarizeStudioActivity({ rows });
  const formatted = studioResultPresentation(summary);
  assert.equal(formatted.preview, "15 paragraphs translated.");
  assert.equal(formatted.long, true);
  for (let i = 1; i <= 15; i++) assert(formatted.html.includes(`Đáp: translated paragraph ${i}. `));
  assert(formatted.html.includes(`${"Long text. ".repeat(59)}Long text.</p>`), "translations are not shortened");
  assert(!formatted.details.includes("paragraphs translated"), "the expanded summary does not repeat the visible count");
  for (let i = 1; i <= 15; i++) assert(formatted.details.includes(`Đáp: translated paragraph ${i}. `));
});

test("review receipts keep each paragraph's translation and verdicts until the review restarts", () => {
  const trial = { translations: [{ paragraphId: "a", translation: "Uno" }, { paragraphId: "b", translation: "Dos" }, { paragraphId: "c", translation: "Tres" }],
    choices: [{ paragraphId: "a", occurrenceId: "o0", passed: true, problem: "" }, { paragraphId: "a", occurrenceId: "o1", passed: false, problem: "Wrong meaning" },
      { paragraphId: "b", occurrenceId: "o0", passed: true, problem: "", rendered: "dos" }] };
  const review = studioReviewOutcomes(trial);
  assert.deepEqual(review, [
    { paragraphId: "a", translation: "Uno", occurrences: [{ occurrenceId: "o0", passed: true, problem: "" }, { occurrenceId: "o1", passed: false, problem: "Wrong meaning" }] },
    { paragraphId: "b", translation: "Dos", occurrences: [{ occurrenceId: "o0", passed: true, problem: "" }] }]);
  const study = { step: "9", activitySteps: {} };
  const activity = createStudioActivity(study, () => {}, () => true);
  activity.finish(["batch-0", "round-0", "assess"], "2 of 3 occurrences passed.", review);
  const node = () => study.activitySteps["9"].items[0].children[0].children[0];
  assert.deepEqual(node().review, review);
  activity.start(["batch-0", "round-0", "assess", "operation:1"], "Reviewing again");
  assert.equal(node().review, undefined);
});

test("forms checklists show original spelling from the start and merge legacy progress without changing saved data", () => {
  const study = { step: "2a" };
  const ids = ["discover", "forms", "origin", "identity", "accepted"];
  assert.deepEqual(studioActivityItems(study).map((item) => item.id), ids);
  const saved = ids.filter((id) => id !== "origin").map((id) => ({ id, label: id,
    status: id === "discover" ? "complete" : "waiting", result: id === "discover" ? "Three proposed forms." : "" }));
  study.activitySteps = { "2a": { items: saved } };
  let original = structuredClone(study);
  let items = studioActivityItems(study);
  assert.deepEqual(items.map((item) => item.id), ids);
  assert.equal(items[0], saved[0]);
  assert.equal(items[0].result, "Three proposed forms.");
  assert.equal(items[2].status, "waiting");
  assert.deepEqual(study, original);
  saved.push({ id: "origin", label: "Verify original spelling", status: "running", result: "Original form found." });
  original = structuredClone(study);
  items = studioActivityItems(study);
  assert.deepEqual(items.map((item) => item.id), ids);
  assert.equal(items[2], saved.at(-1));
  assert.deepEqual(study, original);
  Object.assign(saved.find((item) => item.id === "identity"), { status: "complete", result: "2 forms accepted as the same word." });
  saved.find((item) => item.id === "accepted").children = [{ id: "one", label: "Hierofantes" }, { id: "two", label: "hierofante" }];
  original = structuredClone(study);
  assert.equal(studioActivityItems(study).find((item) => item.id === "identity").result,
    "2 forms accepted as the same word: Hierofantes, hierofante.");
  assert.deepEqual(study, original);
});

test("a missing original-spelling item uses only recorded origin evidence", () => {
  const study = { step: "2a", activitySteps: { "2a": { items: [{ id: "discover", status: "complete" }] } },
    origin: { proposal: { originLanguage: null }, evidence: null } };
  let origin = studioActivityItems(study).find((item) => item.id === "origin");
  assert.equal(origin.status, "complete");
  assert.match(origin.result, /no original-spelling search needed/);
  study.origin = { proposal: { originLanguage: "la" }, evidence: { summary: "Cited evidence." } };
  origin = studioActivityItems(study).find((item) => item.id === "origin");
  assert.equal(origin.status, "complete");
  assert.match(origin.result, /Saved original-spelling findings/);
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

test("an error leaves no row running, and a smaller sample drops batch rows it no longer has", () => {
  const study = { step: "9", activitySteps: {} };
  const activity = createStudioActivity(study, () => {}, () => true);
  activity.plan([{ id: "batch-0", label: "Batch 1 · of 98" }, { id: "batch-90", label: "Batch 7 · of 98" }, { id: "repair-pass-1", label: "Repair" }]);
  activity.start(["repair-pass-1", "group-0"], "Repair group 1");
  activity.stop();
  const items = study.activitySteps["9"].items;
  assert.deepEqual(items.map((item) => item.status), ["waiting", "waiting", "failed"]);
  assert.equal(items[2].children[0].status, "failed");
  activity.plan([{ id: "batch-0", label: "Batch 1 · of 73" }], [], true, "batch-");
  assert.deepEqual(study.activitySteps["9"].items.map((item) => [item.id, item.label]), [["batch-0", "Batch 1 · of 73"], ["repair-pass-1", "Repair"]]);
});
