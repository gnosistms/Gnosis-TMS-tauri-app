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

test("refuses a reload that would discard a dirty row removed on disk", () => {
  const reloadedRows = [reloadedRow("r1", "server one")];
  const liveChapter = {
    chapterId: CHAPTER_ID,
    rows: [{ rowId: "gone", fields: { target: "typed then deleted on disk" } }],
    dirtyRowIds: new Set(["gone"]),
  };

  assert.throws(
    () => mergeInFlightDirtyEditorRows(reloadedRows, liveChapter, CHAPTER_ID),
    /Your draft has been kept in the editor/,
  );
  assert.equal(liveChapter.rows[0].fields.target, "typed then deleted on disk");
  assert.deepEqual([...liveChapter.dirtyRowIds], ["gone"]);
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

test("refuses a reload that removes the language containing a draft", () => {
  const liveRow = {
    ...reloadedRow("r1", "unsaved translation"),
    persistedFields: { target: "saved translation" },
  };
  const liveChapter = { chapterId: CHAPTER_ID, rows: [liveRow], dirtyRowIds: new Set(["r1"]) };
  assert.throws(() => mergeInFlightDirtyEditorRows(
    [reloadedRow("r1", "saved translation")], liveChapter, CHAPTER_ID, [{ code: "source" }],
  ), /A language with unsaved changes was removed/);
  assert.equal(liveChapter.rows[0], liveRow);
});

test("returns the reloaded rows untouched when nothing is dirty", () => {
  const reloadedRows = [reloadedRow("r1", "server one")];
  const liveChapter = { chapterId: CHAPTER_ID, rows: reloadedRows, dirtyRowIds: new Set() };

  const { rows, dirtyRowIds } = mergeInFlightDirtyEditorRows(reloadedRows, liveChapter, CHAPTER_ID);

  assert.equal(rows, reloadedRows);
  assert.equal(dirtyRowIds.size, 0);
});
