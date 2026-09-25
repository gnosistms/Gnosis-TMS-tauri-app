import test from "node:test";
import assert from "node:assert/strict";

globalThis.document = globalThis.document ?? { querySelector: () => null, querySelectorAll: () => [] };
globalThis.window = globalThis.window ?? {};

const { state } = await import("./state.js");
const { appendResearchLogEvent } = await import("./glossary-research-flow.js");

test("parallel streams stay one block per request instead of one line per fragment", () => {
  state.glossaryResearch.log = [];
  for (const id of ["r1", "r2", "r3"]) {
    appendResearchLogEvent({ type: "request", requestId: id, stage: "discovery", purpose: `batch ${id}`, text: "…" });
  }
  const parts = { r1: ['{"items":[', '{"occId":"d001.1"', "}]}"], r2: ['{"items":[', '{"occId":"d011.1"', "}]}"], r3: ['{"items":[', '{"occId":"d021.1"', "}]}"] };
  for (let i = 0; i < 3; i += 1) {
    for (const id of ["r1", "r2", "r3"]) {
      appendResearchLogEvent({ type: "thinking", requestId: id, text: `t${i} ` });
      appendResearchLogEvent({ type: "answer-delta", requestId: id, text: parts[id][i] });
    }
  }
  const streams = state.glossaryResearch.log.filter((entry) => entry.type === "answer-delta");
  assert.equal(streams.length, 3);
  assert.equal(streams[1].text, '{"items":[{"occId":"d011.1"}]}');
  assert.match(streams[1].label, /answer · discovery: batch r2/);
  assert.equal(state.glossaryResearch.log.filter((entry) => entry.type === "thinking").length, 3);
});
