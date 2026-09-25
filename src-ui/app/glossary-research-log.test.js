import test from "node:test";
import assert from "node:assert/strict";

globalThis.document = globalThis.document ?? { querySelector: () => null, querySelectorAll: () => [] };
globalThis.window = globalThis.window ?? {};

const { state } = await import("./state.js");
const { appendResearchLogEvent } = await import("./glossary-research-flow.js");
const {
  batchProgressText,
  buildLogView,
  collapseRepeatedBlocks,
  isRequestOpen,
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
  // Batch requests stay closed unless opened; a lone running request is open.
  assert.equal(isRequestOpen(batch.requests[0], {}), false);
  assert.equal(isRequestOpen(batch.requests[0], { r1: true }), true);
});

test("a request running on its own is open while it runs and closes when done", () => {
  state.glossaryResearch.log = [];
  appendResearchLogEvent({ type: "request", requestId: "p", stage: "proposal", purpose: "consolidate", text: "…" });
  appendResearchLogEvent({ type: "thinking", requestId: "p", text: "Weighing the senses." });
  let [item] = buildLogView(state.glossaryResearch.log);
  assert.equal(requestState(item.request), "thinking");
  assert.equal(isRequestOpen(item.request, {}), true);
  appendResearchLogEvent({ type: "answer-delta", requestId: "p", text: '{"a":1}' });
  appendResearchLogEvent({ type: "usage", requestId: "p", record: { stage: "proposal", status: "ok", seconds: 3, costUsd: 0.2 }, spent: 0.2, limit: 4 });
  [item] = buildLogView(state.glossaryResearch.log);
  assert.equal(isRequestOpen(item.request, {}), false);
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
