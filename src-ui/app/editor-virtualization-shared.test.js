import test from "node:test";
import assert from "node:assert/strict";

import {
  EDITOR_ROW_GAP_PX,
  buildEditorRowHeights,
  calculateEditorVirtualWindow,
  estimateEditorRowHeight,
} from "./editor-virtualization-shared.js";

test("estimateEditorRowHeight uses a compact fixed height for deleted groups", () => {
  assert.equal(estimateEditorRowHeight({ kind: "deleted-group" }), 44);
});

test("estimateEditorRowHeight accounts for expanded and collapsed language panels", () => {
  const row = {
    sections: [
      { code: "es" },
      { code: "vi" },
      { code: "en" },
    ],
  };

  const fullyExpanded = estimateEditorRowHeight(row, new Set(), 20);
  const mostlyCollapsed = estimateEditorRowHeight(row, new Set(["vi", "en"]), 20);

  assert.equal(fullyExpanded > mostlyCollapsed, true);
});

test("buildEditorRowHeights prefers measured cache entries over estimated heights", () => {
  const rows = [
    { id: "row-1", sections: [{ code: "es" }] },
    { id: "row-2", sections: [{ code: "es" }] },
  ];
  const cache = new Map([["row-2", 321]]);

  const heights = buildEditorRowHeights(rows, cache, new Set(), 20);

  assert.equal(heights[0], estimateEditorRowHeight(rows[0], new Set(), 20));
  assert.equal(heights[1], 321);
});

test("calculateEditorVirtualWindow returns the visible range and spacer heights", () => {
  const windowState = calculateEditorVirtualWindow([100, 100, 100, 100], 130, 150);

  assert.deepEqual(windowState, {
    startIndex: 0,
    endIndex: 4,
    topSpacerHeight: 0,
    bottomSpacerHeight: 0,
  });
});

test("calculateEditorVirtualWindow keeps a pinned row rendered even when it is outside the viewport", () => {
  const heights = [120, 120, 120, 120, 120, 120];
  const scrollTop = heights[0] + heights[1] + heights[2] + 3 * EDITOR_ROW_GAP_PX;
  const windowState = calculateEditorVirtualWindow(heights, scrollTop, 150, 0);

  assert.equal(windowState.startIndex, 0);
  assert.equal(windowState.endIndex > 0, true);
});

test("calculateEditorVirtualWindow handles empty row lists", () => {
  assert.deepEqual(calculateEditorVirtualWindow([], 0, 0), {
    startIndex: 0,
    endIndex: 0,
    topSpacerHeight: 0,
    bottomSpacerHeight: 0,
  });
});
