import test from "node:test";
import assert from "node:assert/strict";

const {
  EDITOR_ROW_GAP_PX,
  hasEditorVirtualWindowCoverageGap,
  nextScheduledEditorRenderReason,
  shouldDeferMeasuredWindowReconcile,
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

test("shouldDeferMeasuredWindowReconcile only defers unanchored scroll renders when enabled", () => {
  assert.equal(shouldDeferMeasuredWindowReconcile("scroll", null, true), true);
  assert.equal(shouldDeferMeasuredWindowReconcile("scroll", { rowId: "row-1" }, true), false);
  assert.equal(shouldDeferMeasuredWindowReconcile("row-layout", null, true), false);
});

test("shouldDeferMeasuredWindowReconcile stays disabled when deferred scroll reconcile is off", () => {
  assert.equal(shouldDeferMeasuredWindowReconcile("scroll", null, false), false);
});

test("hasEditorVirtualWindowCoverageGap detects an under-covered viewport before unrendered rows", () => {
  assert.equal(
    hasEditorVirtualWindowCoverageGap({
      rowCount: 20,
      startIndex: 5,
      endIndex: 8,
      viewportTop: 100,
      viewportBottom: 600,
      firstRowTop: 80,
      lastRowBottom: 520,
    }),
    true,
  );
});

test("hasEditorVirtualWindowCoverageGap allows the normal row gap before the next row", () => {
  assert.equal(
    hasEditorVirtualWindowCoverageGap({
      rowCount: 20,
      startIndex: 5,
      endIndex: 8,
      viewportTop: 100,
      viewportBottom: 600,
      firstRowTop: 80,
      lastRowBottom: 600 - EDITOR_ROW_GAP_PX,
    }),
    false,
  );
});

test("hasEditorVirtualWindowCoverageGap ignores lower viewport space after the final row", () => {
  assert.equal(
    hasEditorVirtualWindowCoverageGap({
      rowCount: 8,
      startIndex: 5,
      endIndex: 8,
      viewportTop: 100,
      viewportBottom: 600,
      firstRowTop: 80,
      lastRowBottom: 400,
    }),
    false,
  );
});
