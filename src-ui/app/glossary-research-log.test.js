import test from "node:test";
import assert from "node:assert/strict";

globalThis.document = globalThis.document ?? { querySelector: () => null, querySelectorAll: () => [] };
globalThis.window = globalThis.window ?? {};

const { state } = await import("./state.js");
const { appendResearchLogEvent } = await import("./glossary-research-flow.js");
const {
  batchProgressText,
  buildLogSections,
  buildLogView,
  liveRequest,
  requestBatch,
  sectionSummary,
  collapseRepeatedBlocks,
  readableAnswer,
  requestState,
  requestStatusText,
  requestTitle,
} = await import("./glossary-research-log-view.js");

const usd = (value) => `$${value.toFixed(2)}`;

function streamThreeBatchRequests() {
  state.glossaryResearch.log = [];
  appendResearchLogEvent({ type: "heading", text: "Discovery" });
  ["r1", "r2", "r3"].forEach((id, index) => {
    appendResearchLogEvent({ type: "request", requestId: id, stage: "discovery", purpose: "open reading of 10 occurrences", text: "…", batch: { key: "k", number: index + 1, total: 3 } });
  });
  const parts = { r1: ['{"items":[', '{"occId":"d001.1"', "}]}"], r2: ['{"items":[', '{"occId":"d011.1"', "}]}"], r3: ['{"items":[', '{"occId":"d021.1"', "}]}"] };
  for (let i = 0; i < 3; i += 1) {
    for (const id of ["r1", "r2", "r3"]) {
      appendResearchLogEvent({ type: "thinking", requestId: id, text: `t${i} ` });
      appendResearchLogEvent({ type: "answer-delta", requestId: id, text: parts[id][i] });
    }
  }
  return state.glossaryResearch.log;
}

test("parallel streams are stored as one thinking and one answer entry per request", () => {
  const log = streamThreeBatchRequests();
  assert.equal(log.filter((entry) => entry.type === "answer-delta").length, 3);
  assert.equal(log.filter((entry) => entry.type === "thinking").length, 3);
});

test("requests of one batch are grouped under one progress line", () => {
  const log = streamThreeBatchRequests();
  appendResearchLogEvent({ type: "usage", requestId: "r2", record: { stage: "discovery", status: "ok", seconds: 12.4, costUsd: 0.041, inputTokens: 1, outputTokens: 1 }, spent: 0.04, limit: 4 });
  const view = buildLogView(log);
  assert.deepEqual(view.map((item) => item.kind), ["line", "batch"]);
  const [, batch] = view;
  assert.equal(batch.requests.length, 3);
  assert.equal(batch.requests[1].answer, '{"items":[{"occId":"d011.1"}]}');
  assert.equal(batchProgressText(batch), "1 of 3 done, 2 running");
  assert.equal(requestTitle(batch.requests[1]), "Batch 2 of 3 · open reading of 10 occurrences");
  assert.equal(requestStatusText(batch.requests[1], usd), "done · 12 s · $0.04");
  assert.match(requestStatusText(batch.requests[0], usd), /^writing the answer… 30 characters$/);
});

test("a request running on its own reports its state as it streams", () => {
  state.glossaryResearch.log = [];
  appendResearchLogEvent({ type: "request", requestId: "p", stage: "proposal", purpose: "consolidate", text: "…" });
  appendResearchLogEvent({ type: "thinking", requestId: "p", text: "Weighing the senses." });
  let [item] = buildLogView(state.glossaryResearch.log);
  assert.equal(requestState(item.request), "thinking");
  appendResearchLogEvent({ type: "answer-delta", requestId: "p", text: '{"a":1}' });
  appendResearchLogEvent({ type: "usage", requestId: "p", record: { stage: "proposal", status: "ok", seconds: 3, costUsd: 0.2 }, spent: 0.2, limit: 4 });
  [item] = buildLogView(state.glossaryResearch.log);
  assert.equal(requestState(item.request), "done");
  assert.equal(readableAnswer(item.request.answer), '{\n  "a": 1\n}');
});

test("logs saved in fragments read as one request", () => {
  const old = [
    { type: "request", requestId: "c1", stage: "counting", purpose: "translate", text: "→ counting: translate\nTexts" },
    { type: "answer-delta", requestId: "c1", text: '{"items":' },
    { type: "answer-delta", requestId: "c1", text: "[]}" },
    { type: "usage", requestId: "c1", text: "counting: ok, 10 in (0 cached), 5 out (0 thinking), $0.01, 2.0 s — total $0.01 of $4.00" },
  ];
  const [item] = buildLogView(old);
  assert.equal(item.request.answer, '{"items":[]}');
  assert.equal(item.request.text, "Texts");
  assert.equal(requestState(item.request), "done");
});

test("identical repeated blocks are shown once with a count", () => {
  const review = [{ type: "heading", text: "Review" }, { type: "fact", text: "Waiting for you to review." }];
  const log = [{ type: "heading", text: "Proposal" }, { type: "fact", text: "1 entry" }, ...review, ...review, ...review,
    { type: "heading", text: "Counting" }, { type: "request", requestId: "c1", stage: "counting", text: "…" }];
  const shown = collapseRepeatedBlocks(buildLogView(log));
  assert.deepEqual(shown.filter((i) => i.kind === "line").map((i) => i.entry.text),
    ["Proposal", "1 entry", "Review (×3)", "Waiting for you to review.", "Counting"]);
  assert.equal(shown.filter((i) => i.kind === "request").length, 1);
});

test("the review list adds a typed translation once and clears the box", async () => {
  const { addResearchProposalVariantText, updateResearchProposalField } = await import("./glossary-research-flow.js");
  state.glossaryResearch.proposalDraft = { entries: [{ id: "e1", kind: "word", sourceTerms: ["astral"], variants: [{ id: "e1v1", target: "thể vía", note: "n" }] }] };
  updateResearchProposalField([0, "addDraft"], "  cơ thể cảm xúc ");
  let renders = 0;
  addResearchProposalVariantText(() => { renders += 1; }, 0);
  updateResearchProposalField([0, "addDraft"], "Cơ thể cảm xúc");
  addResearchProposalVariantText(() => { renders += 1; }, 0);
  const entry = state.glossaryResearch.proposalDraft.entries[0];
  assert.deepEqual(entry.variants.map((v) => v.target), ["thể vía", "cơ thể cảm xúc"]);
  assert.equal(entry.variants[1].note, "");
  assert.equal(entry.addDraft, "");
  assert.equal(renders, 2);
});

test("the log reads as sections: lines and findings with the requests made under each heading", () => {
  state.glossaryResearch.log = [];
  appendResearchLogEvent({ type: "fact", text: "before any heading" });
  appendResearchLogEvent({ type: "heading", text: "Candidate translations" });
  appendResearchLogEvent({ type: "request", requestId: "c", stage: "candidates", purpose: "propose", text: "…" });
  appendResearchLogEvent({ type: "usage", requestId: "c", record: { stage: "candidates", status: "ok", seconds: 91, costUsd: 0.05 }, spent: 0.05, limit: 4 });
  appendResearchLogEvent({ type: "result", kind: "candidates", data: [{ sense: "s1", groups: [{ recommended: true, members: ["a"] }] }], text: "s1: ★ a" });
  appendResearchLogEvent({ type: "result", kind: "candidates", data: [{ sense: "s2", groups: [] }], text: "s2: " });
  appendResearchLogEvent({ type: "heading", text: "Candidate checks" });
  appendResearchLogEvent({ type: "result", kind: "checks", text: "old finding without data" });
  const sections = buildLogSections(state.glossaryResearch.log);
  assert.deepEqual(sections.map((s) => s.heading), [null, "Candidate translations", "Candidate checks"]);
  const [, candidates, checks] = sections;
  assert.equal(candidates.requests.length, 1);
  assert.deepEqual(candidates.meta, { count: 1, seconds: 91, costUsd: 0.05, running: 0, failed: 0 });
  assert.equal(candidates.items.length, 1, "consecutive findings of one kind form one block");
  assert.deepEqual(candidates.items[0].data.map((d) => d.sense), ["s1", "s2"]);
  assert.equal(checks.items[0].data, null);
  assert.deepEqual(checks.items[0].texts, ["old finding without data"]);
});

test("old logs without findings still section by heading", () => {
  const sections = buildLogSections([
    { type: "heading", text: "Proposal" }, { type: "fact", text: "1 entry" },
    { type: "request", requestId: "p", stage: "proposal", text: "→ proposal: x\nTexts" },
  ]);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].items[0].entry.text, "1 entry");
  assert.equal(sections[0].requests[0].text, "Texts");
});

test("the live panel follows the request that changed last, unless one was picked", () => {
  const log = streamThreeBatchRequests();
  const r1 = log.find((entry) => entry.type === "answer-delta" && entry.requestId === "r1");
  r1.updatedAt = Date.now() + 1000;
  let sections = buildLogSections(log);
  assert.equal(liveRequest(sections).requestId, "r1");
  assert.equal(liveRequest(sections, "r3").requestId, "r3");
  assert.equal(liveRequest(sections, "gone").requestId, "r1");
  const batch = requestBatch(sections, liveRequest(sections));
  assert.deepEqual([batch.total, batch.done, batch.running], [3, 0, 3]);
  for (const id of ["r1", "r2", "r3"]) {
    appendResearchLogEvent({ type: "usage", requestId: id, record: { stage: "discovery", status: "ok", seconds: 1, costUsd: 0.01 }, spent: 0.03, limit: 4 });
  }
  sections = buildLogSections(state.glossaryResearch.log);
  assert.equal(liveRequest(sections), null, "nothing runs: the panel has nothing to follow");
  assert.equal(sections[0].meta.count, 3);
});

test("a finished request picked in the panel gives way to the running one", () => {
  const log = streamThreeBatchRequests();
  appendResearchLogEvent({ type: "usage", requestId: "r2", record: { stage: "discovery", status: "ok", seconds: 1, costUsd: 0.01 }, spent: 0.01, limit: 4 });
  const sections = buildLogSections(log);
  assert.notEqual(liveRequest(sections, "r2").requestId, "r2");
  assert.equal(liveRequest(sections, "r3").requestId, "r3", "a running batch member can be picked");
});

test("a finished step reads as one line of what it found", () => {
  const sections = buildLogSections([
    { type: "heading", text: "Dictionary" }, { type: "info", text: "trying" }, { type: "fact", text: "DLE: found (2 senses)" },
    { type: "heading", text: "Candidate checks" },
    { type: "result", kind: "checks", data: [{ target: "a", verdict: "pass" }, { target: "b", verdict: "fail" }], text: "x" },
    { type: "result", kind: "checks", data: [{ target: "c", verdict: "unclear" }], text: "y" },
    { type: "heading", text: "Old" }, { type: "result", kind: "mystery", text: "kept text" },
  ]);
  assert.deepEqual(sections.map(sectionSummary), ["DLE: found (2 senses)", "1 pass, 1 unclear, 1 fail (3 candidates checked)", "kept text"]);
});
