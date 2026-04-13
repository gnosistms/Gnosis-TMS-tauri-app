import test from "node:test";
import assert from "node:assert/strict";

import {
  applyInsertedEditorRowState,
  applyPermanentlyDeletedEditorRowState,
  applyRestoredEditorRowState,
  applySoftDeletedEditorRowState,
  openInsertEditorRowModalState,
  toggleDeletedEditorRowGroupState,
} from "./editor-row-structure-state.js";
import { createEditorChapterState, createEditorHistoryState } from "./state.js";

function row(rowId, lifecycleState = "active", fields = {}) {
  return {
    rowId,
    orderKey: rowId,
    lifecycleState,
    fields: { ...fields },
    persistedFields: { ...fields },
    fieldStates: {},
    persistedFieldStates: {},
    saveStatus: "idle",
    saveError: "",
    markerSaveState: {
      status: "idle",
      languageCode: null,
      kind: null,
      error: "",
    },
  };
}

test("toggleDeletedEditorRowGroupState toggles the expanded group membership", () => {
  const chapterState = {
    ...createEditorChapterState(),
    chapterId: "chapter-1",
    expandedDeletedRowGroupIds: new Set(["group-a"]),
  };

  const collapsed = toggleDeletedEditorRowGroupState(chapterState, "group-a");
  const expanded = toggleDeletedEditorRowGroupState(collapsed, "group-b");

  assert.deepEqual([...collapsed.expandedDeletedRowGroupIds], []);
  assert.deepEqual([...expanded.expandedDeletedRowGroupIds], ["group-b"]);
});

test("openInsertEditorRowModalState opens the modal only for an existing row", () => {
  const chapterState = {
    ...createEditorChapterState(),
    chapterId: "chapter-1",
    rows: [row("row-1")],
  };

  const opened = openInsertEditorRowModalState(chapterState, "row-1");
  const unchanged = openInsertEditorRowModalState(chapterState, "row-missing");

  assert.equal(opened.insertRowModal.isOpen, true);
  assert.equal(opened.insertRowModal.rowId, "row-1");
  assert.equal(unchanged.insertRowModal.isOpen, false);
});

test("applyInsertedEditorRowState inserts a normalized row and activates it", () => {
  const chapterState = {
    ...createEditorChapterState(),
    chapterId: "chapter-1",
    selectedSourceLanguageCode: "en",
    selectedTargetLanguageCode: "es",
    rows: [row("row-1", "active", { en: "one" }), row("row-3", "active", { en: "three" })],
    insertRowModal: {
      ...createEditorChapterState().insertRowModal,
      isOpen: true,
      rowId: "row-1",
    },
  };

  const nextState = applyInsertedEditorRowState(
    chapterState,
    {
      rowId: "row-2",
      fields: { en: "two" },
      fieldStates: {},
    },
    "row-3",
    true,
    { en: 42 },
  );

  assert.deepEqual(nextState.rows.map((entry) => entry.rowId), ["row-1", "row-2", "row-3"]);
  assert.equal(nextState.rows[1].persistedFields.en, "two");
  assert.equal(nextState.activeRowId, "row-2");
  assert.equal(nextState.activeLanguageCode, "es");
  assert.equal(nextState.insertRowModal.isOpen, false);
  assert.deepEqual(nextState.sourceWordCounts, { en: 42 });
});

test("applySoftDeletedEditorRowState clears the active field and anchors to a closed deleted group", () => {
  const chapterState = {
    ...createEditorChapterState(),
    chapterId: "chapter-1",
    activeRowId: "row-2",
    activeLanguageCode: "en",
    history: {
      ...createEditorHistoryState(),
      status: "ready",
      rowId: "row-2",
      languageCode: "en",
      entries: [{ commitSha: "abc123" }],
    },
    rows: [row("row-1"), row("row-2"), row("row-3")],
    expandedDeletedRowGroupIds: new Set(),
  };

  const result = applySoftDeletedEditorRowState(
    chapterState,
    "row-2",
    "deleted",
    { en: 9 },
    { offsetTop: 120 },
  );

  assert.equal(result.chapterState.rows[1].lifecycleState, "deleted");
  assert.equal(result.chapterState.activeRowId, null);
  assert.equal(result.chapterState.activeLanguageCode, null);
  assert.equal(result.chapterState.history.status, "idle");
  assert.deepEqual([...result.chapterState.expandedDeletedRowGroupIds], []);
  assert.deepEqual(result.chapterState.sourceWordCounts, { en: 9 });
  assert.deepEqual(result.anchorSnapshot, {
    type: "deleted-group",
    rowId: "deleted-group:row-2",
    languageCode: null,
    offsetTop: 120,
  });
});

test("applyRestoredEditorRowState keeps remaining deleted groups open after a restore split", () => {
  const chapterState = {
    ...createEditorChapterState(),
    chapterId: "chapter-1",
    rows: [row("row-1", "deleted"), row("row-2", "deleted"), row("row-3", "deleted")],
    expandedDeletedRowGroupIds: new Set(["row-1:row-2:row-3"]),
  };

  const nextState = applyRestoredEditorRowState(chapterState, "row-2", "active");

  assert.deepEqual(nextState.rows.map((entry) => entry.lifecycleState), ["deleted", "active", "deleted"]);
  assert.deepEqual([...nextState.expandedDeletedRowGroupIds].sort(), ["row-1", "row-3"]);
});

test("applyPermanentlyDeletedEditorRowState removes the row, clears dirty tracking, and closes the modal", () => {
  const chapterState = {
    ...createEditorChapterState(),
    chapterId: "chapter-1",
    activeRowId: "row-2",
    activeLanguageCode: "en",
    history: {
      ...createEditorHistoryState(),
      status: "ready",
      rowId: "row-2",
      languageCode: "en",
      entries: [{ commitSha: "abc123" }],
    },
    dirtyRowIds: new Set(["row-2"]),
    rows: [row("row-1", "deleted"), row("row-2", "deleted"), row("row-3")],
    expandedDeletedRowGroupIds: new Set(["row-1:row-2"]),
    rowPermanentDeletionModal: {
      ...createEditorChapterState().rowPermanentDeletionModal,
      isOpen: true,
      rowId: "row-2",
    },
  };

  const nextState = applyPermanentlyDeletedEditorRowState(chapterState, "row-2", { en: 7 });

  assert.deepEqual(nextState.rows.map((entry) => entry.rowId), ["row-1", "row-3"]);
  assert.deepEqual([...nextState.dirtyRowIds], []);
  assert.deepEqual([...nextState.expandedDeletedRowGroupIds], ["row-1"]);
  assert.equal(nextState.activeRowId, null);
  assert.equal(nextState.activeLanguageCode, null);
  assert.equal(nextState.history.status, "idle");
  assert.equal(nextState.rowPermanentDeletionModal.isOpen, false);
  assert.deepEqual(nextState.sourceWordCounts, { en: 7 });
});
