import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBatchSourceContext,
  buildRowSourceContextWindow,
  estimateSourceTokens,
} from "./editor-ai-context-window.js";

function row(id, source, target = "") {
  return { rowId: id, fields: { en: source, vi: target } };
}

// A chapter with short rows so every row fits the token budget.
function chapter(count) {
  return {
    rows: Array.from({ length: count }, (_, i) => row(`r${i}`, `Source ${i}.`, `Target ${i}.`)),
  };
}

test("buildRowSourceContextWindow returns before + row + after in order", () => {
  const window = buildRowSourceContextWindow(chapter(5), "r2", "en", "vi");
  const ids = window.map((entry) => entry.rowId);
  assert.deepEqual(ids, ["r0", "r1", "r2", "r3", "r4"]);
  const middle = window.find((entry) => entry.rowId === "r2");
  assert.equal(middle.sourceText, "Source 2.");
  assert.equal(middle.targetText, "Target 2.");
});

test("buildRowSourceContextWindow returns empty for an unknown row", () => {
  assert.deepEqual(buildRowSourceContextWindow(chapter(3), "missing", "en", "vi"), []);
});

test("buildBatchSourceContext excludes the batch span and only walks outward", () => {
  const { contextBefore, contextAfter } = buildBatchSourceContext(
    chapter(6),
    "r2",
    "r4",
    "en",
    "vi",
  );
  assert.deepEqual(contextBefore.map((e) => e.rowId), ["r0", "r1"]);
  assert.deepEqual(contextAfter.map((e) => e.rowId), ["r5"]);
});

test("buildBatchSourceContext gives no before-context for the first row", () => {
  const { contextBefore, contextAfter } = buildBatchSourceContext(
    chapter(4),
    "r0",
    "r1",
    "en",
    "vi",
  );
  assert.deepEqual(contextBefore, []);
  assert.deepEqual(contextAfter.map((e) => e.rowId), ["r2", "r3"]);
});

test("buildBatchSourceContext gives no after-context for the last row", () => {
  const { contextBefore, contextAfter } = buildBatchSourceContext(
    chapter(4),
    "r2",
    "r3",
    "en",
    "vi",
  );
  assert.deepEqual(contextBefore.map((e) => e.rowId), ["r0", "r1"]);
  assert.deepEqual(contextAfter, []);
});

test("context window respects the before/after token budgets", () => {
  // One very long row before the target consumes the whole before-budget, so the
  // walk stops after including it.
  const longSource = "word ".repeat(600); // ~ well over the 360-token before budget
  const rows = [
    row("far", "short."),
    row("near", longSource),
    row("target", "the target."),
    row("after", "short after."),
  ];
  const window = buildRowSourceContextWindow({ rows }, "target", "en", "vi");
  const ids = window.map((entry) => entry.rowId);
  // "near" is included (it is the first before-row), but the budget is spent so
  // "far" is not reached.
  assert.ok(ids.includes("near"));
  assert.ok(!ids.includes("far"));
});

test("estimateSourceTokens counts CJK heavier than latin", () => {
  assert.ok(estimateSourceTokens("漢字漢字") > estimateSourceTokens("abcd"));
  assert.equal(estimateSourceTokens(""), 0);
});
