import test from "node:test";
import assert from "node:assert/strict";

import {
  compactExpandedDeletedRowGroupIds,
  deletedRowGroupIdAfterSoftDelete,
  expandedDeletedRowGroupIdsAfterPermanentDelete,
  expandedDeletedRowGroupIdsAfterRestore,
  expandedDeletedRowGroupIdsAfterSoftDelete,
} from "./editor-deleted-rows.js";

function row(rowId, lifecycleState = "active") {
  return {
    rowId,
    lifecycleState,
  };
}

test("first soft-delete creates a closed deleted group", () => {
  const previousRows = [
    row("row-1"),
    row("row-2"),
    row("row-3"),
  ];
  const nextRows = [
    row("row-1"),
    row("row-2", "deleted"),
    row("row-3"),
  ];

  const nextExpanded = expandedDeletedRowGroupIdsAfterSoftDelete(previousRows, "row-2", new Set(), nextRows);

  assert.deepEqual([...nextExpanded], []);
  assert.equal(deletedRowGroupIdAfterSoftDelete(previousRows, "row-2"), "row-2");
});

test("soft-deleting beside an open deleted group keeps the merged group open", () => {
  const previousRows = [
    row("row-1", "deleted"),
    row("row-2"),
    row("row-3"),
  ];
  const nextRows = [
    row("row-1", "deleted"),
    row("row-2", "deleted"),
    row("row-3"),
  ];

  const nextExpanded = expandedDeletedRowGroupIdsAfterSoftDelete(
    previousRows,
    "row-2",
    new Set(["row-1"]),
    nextRows,
  );

  assert.deepEqual([...nextExpanded], ["row-1:row-2"]);
});

test("soft-deleting beside a closed deleted group keeps the merged group closed", () => {
  const previousRows = [
    row("row-1", "deleted"),
    row("row-2"),
    row("row-3"),
  ];
  const nextRows = [
    row("row-1", "deleted"),
    row("row-2", "deleted"),
    row("row-3"),
  ];

  const nextExpanded = expandedDeletedRowGroupIdsAfterSoftDelete(previousRows, "row-2", new Set(), nextRows);

  assert.deepEqual([...nextExpanded], []);
});

test("restoring the last row in a deleted group clears stale expanded ids", () => {
  const previousRows = [
    row("row-1"),
    row("row-2", "deleted"),
    row("row-3"),
  ];
  const nextRows = [
    row("row-1"),
    row("row-2"),
    row("row-3"),
  ];

  const nextExpanded = expandedDeletedRowGroupIdsAfterRestore(
    previousRows,
    "row-2",
    new Set(["row-2"]),
    nextRows,
  );

  assert.deepEqual([...nextExpanded], []);
});

test("restoring a row from an open deleted run keeps the remaining sides open", () => {
  const previousRows = [
    row("row-1", "deleted"),
    row("row-2", "deleted"),
    row("row-3", "deleted"),
  ];
  const nextRows = [
    row("row-1", "deleted"),
    row("row-2"),
    row("row-3", "deleted"),
  ];

  const nextExpanded = expandedDeletedRowGroupIdsAfterRestore(
    previousRows,
    "row-2",
    new Set(["row-1:row-2:row-3"]),
    nextRows,
  );

  assert.deepEqual([...nextExpanded].sort(), ["row-1", "row-3"]);
});

test("permanent delete keeps an open deleted run open after it shrinks", () => {
  const previousRows = [
    row("row-1", "deleted"),
    row("row-2", "deleted"),
    row("row-3"),
  ];
  const nextRows = [
    row("row-1", "deleted"),
    row("row-3"),
  ];

  const nextExpanded = expandedDeletedRowGroupIdsAfterPermanentDelete(
    previousRows,
    "row-2",
    new Set(["row-1:row-2"]),
    nextRows,
  );

  assert.deepEqual([...nextExpanded], ["row-1"]);
});

test("compacting expanded deleted groups drops ids that no longer exist", () => {
  const rows = [
    row("row-1"),
    row("row-2", "deleted"),
    row("row-3"),
  ];

  const compacted = compactExpandedDeletedRowGroupIds(rows, new Set(["row-2", "row-x"]));

  assert.deepEqual([...compacted], ["row-2"]);
});
