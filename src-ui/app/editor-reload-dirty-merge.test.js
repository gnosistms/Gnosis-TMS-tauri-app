import test from "node:test";
import assert from "node:assert/strict";

import { mergeInFlightDirtyEditorRows } from "./editor-chapter-load-flow.js";

const CHAPTER_ID = "chapter-1";

function reloadedRow(rowId, text) {
  return { rowId, fields: { target: text }, lifecycleState: "active" };
}

test("preserves in-flight typed content and dirty ids for a same-chapter reload", () => {
  const reloadedRows = [
    reloadedRow("r1", "server one"),
    reloadedRow("r2", "server two"),
    reloadedRow("r3", "server three"),
  ];
  // The user typed into r2 while the reload payload was in flight.
  const liveRowR2 = { rowId: "r2", fields: { target: "locally typed" }, lifecycleState: "active" };
  const liveChapter = {
    chapterId: CHAPTER_ID,
    rows: [reloadedRow("r1", "server one"), liveRowR2, reloadedRow("r3", "server three")],
    dirtyRowIds: new Set(["r2"]),
  };

  const { rows, dirtyRowIds } = mergeInFlightDirtyEditorRows(reloadedRows, liveChapter, CHAPTER_ID);

  assert.equal(rows[1], liveRowR2, "the live dirty row object is kept, not the reloaded one");
  assert.equal(rows[1].fields.target, "locally typed");
  assert.equal(rows[0].fields.target, "server one", "non-dirty rows come from the payload");
  assert.deepEqual([...dirtyRowIds], ["r2"], "dirty tracking survives the reload");
});

test("drops dirty ids for rows the reload no longer contains", () => {
  const reloadedRows = [reloadedRow("r1", "server one")];
  const liveChapter = {
    chapterId: CHAPTER_ID,
    rows: [{ rowId: "gone", fields: { target: "typed then deleted on disk" } }],
    dirtyRowIds: new Set(["gone"]),
  };

  const { rows, dirtyRowIds } = mergeInFlightDirtyEditorRows(reloadedRows, liveChapter, CHAPTER_ID);

  assert.equal(rows.length, 1);
  assert.equal(dirtyRowIds.size, 0, "a dirty row absent from the payload is not resurrected");
});

test("does not merge when the live chapter is a different chapter", () => {
  const reloadedRows = [reloadedRow("r1", "server one")];
  const liveChapter = {
    chapterId: "other-chapter",
    rows: [{ rowId: "r1", fields: { target: "stale from other chapter" } }],
    dirtyRowIds: new Set(["r1"]),
  };

  const { rows, dirtyRowIds } = mergeInFlightDirtyEditorRows(reloadedRows, liveChapter, CHAPTER_ID);

  assert.equal(rows[0].fields.target, "server one");
  assert.equal(dirtyRowIds.size, 0);
});

test("returns the reloaded rows untouched when nothing is dirty", () => {
  const reloadedRows = [reloadedRow("r1", "server one")];
  const liveChapter = { chapterId: CHAPTER_ID, rows: reloadedRows, dirtyRowIds: new Set() };

  const { rows, dirtyRowIds } = mergeInFlightDirtyEditorRows(reloadedRows, liveChapter, CHAPTER_ID);

  assert.equal(rows, reloadedRows);
  assert.equal(dirtyRowIds.size, 0);
});
