import test from "node:test";
import assert from "node:assert/strict";

const {
  nextScheduledEditorRenderReason,
  resolveEditorVirtualRangeState,
} = await import("./editor-virtualization-shared.js");

test("nextScheduledEditorRenderReason upgrades a queued scroll render to a layout render", () => {
  assert.equal(nextScheduledEditorRenderReason("", "scroll"), "scroll");
  assert.equal(nextScheduledEditorRenderReason("scroll", "row-layout"), "row-layout");
  assert.equal(nextScheduledEditorRenderReason("scroll", "resize"), "resize");
});

test("nextScheduledEditorRenderReason keeps an existing layout render when scroll follows", () => {
  assert.equal(nextScheduledEditorRenderReason("row-layout", "scroll"), "row-layout");
  assert.equal(nextScheduledEditorRenderReason("resize", "scroll"), "resize");
});

test("resolveEditorVirtualRangeState converts virtual items into spacer heights", () => {
  assert.deepEqual(
    resolveEditorVirtualRangeState(
      [
        { index: 3, start: 300, end: 380 },
        { index: 4, start: 404, end: 520 },
      ],
      1000,
    ),
    {
      startIndex: 3,
      endIndex: 5,
      topSpacerHeight: 300,
      bottomSpacerHeight: 480,
      rangeKey: "3:5",
    },
  );
});

test("resolveEditorVirtualRangeState handles an empty virtual range", () => {
  assert.deepEqual(
    resolveEditorVirtualRangeState([], 240),
    {
      startIndex: 0,
      endIndex: 0,
      topSpacerHeight: 0,
      bottomSpacerHeight: 240,
      rangeKey: "0:0",
    },
  );
});

test("virtual spacers exclude controls above the list without counting their height twice", () => {
  for (const margin of [16, 106, 182]) {
    assert.deepEqual(resolveEditorVirtualRangeState([
      { index: 3, start: margin + 300, end: margin + 380 },
      { index: 4, start: margin + 404, end: margin + 520 },
    ], 1000, margin), {
      startIndex: 3, endIndex: 5, topSpacerHeight: 300,
      bottomSpacerHeight: 480, rangeKey: "3:5",
    });
    assert.equal(resolveEditorVirtualRangeState([
      { index: 0, start: margin, end: margin + 80 },
    ], 1000, margin).topSpacerHeight, 0);
    assert.equal(resolveEditorVirtualRangeState([], 1000, margin).bottomSpacerHeight, 1000);
  }
});
