import test from "node:test";
import assert from "node:assert/strict";

const {
  nextScheduledEditorRenderReason,
  shouldMeasureVisibleRowHeightsDuringRender,
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

test("shouldMeasureVisibleRowHeightsDuringRender skips scroll renders and keeps layout renders measured", () => {
  assert.equal(shouldMeasureVisibleRowHeightsDuringRender("scroll", true), false);
  assert.equal(shouldMeasureVisibleRowHeightsDuringRender("row-layout", true), true);
  assert.equal(shouldMeasureVisibleRowHeightsDuringRender("resize", true), true);
});

test("shouldMeasureVisibleRowHeightsDuringRender keeps scroll measurement enabled outside Windows mode", () => {
  assert.equal(shouldMeasureVisibleRowHeightsDuringRender("scroll", false), true);
});
