import test from "node:test";
import assert from "node:assert/strict";

import {
  applyEditorChapterRowsUnreviewed,
  cancelEditorUnreviewAllModalState,
  openEditorUnreviewAllModalState,
} from "./editor-review-state.js";
import { createEditorChapterState } from "./state.js";

function row(rowId, fieldStates = {}, overrides = {}) {
  return {
    rowId,
    orderKey: rowId,
    lifecycleState: "active",
    fields: { es: "uno" },
    persistedFields: { es: "uno" },
    fieldStates,
    persistedFieldStates: fieldStates,
    saveStatus: "idle",
    saveError: "",
    freshness: "fresh",
    remotelyDeleted: false,
    conflictState: null,
    markerSaveState: {
      status: "idle",
      languageCode: null,
      kind: null,
      error: "",
    },
    ...overrides,
  };
}

test("openEditorUnreviewAllModalState opens only for a valid chapter language", () => {
  const chapterState = {
    ...createEditorChapterState(),
    chapterId: "chapter-1",
    languages: [{ code: "en" }, { code: "es" }],
  };

  const opened = openEditorUnreviewAllModalState(chapterState, "es");
  const unchanged = openEditorUnreviewAllModalState(chapterState, "fr");

  assert.equal(opened.unreviewAllModal.isOpen, true);
  assert.equal(opened.unreviewAllModal.languageCode, "es");
  assert.equal(unchanged.unreviewAllModal.isOpen, false);
});

test("cancelEditorUnreviewAllModalState resets the modal", () => {
  const chapterState = {
    ...createEditorChapterState(),
    chapterId: "chapter-1",
    unreviewAllModal: {
      ...createEditorChapterState().unreviewAllModal,
      isOpen: true,
      languageCode: "es",
      error: "bad",
    },
  };

  const canceled = cancelEditorUnreviewAllModalState(chapterState);

  assert.equal(canceled.unreviewAllModal.isOpen, false);
  assert.equal(canceled.unreviewAllModal.languageCode, null);
  assert.equal(canceled.unreviewAllModal.error, "");
});

test("applyEditorChapterRowsUnreviewed clears reviewed flags and preserves please-check", () => {
  const chapterState = {
    ...createEditorChapterState(),
    chapterId: "chapter-1",
    languages: [{ code: "en" }, { code: "es" }],
    dirtyRowIds: new Set(["row-1"]),
    unreviewAllModal: {
      ...createEditorChapterState().unreviewAllModal,
      isOpen: true,
      languageCode: "es",
    },
    rows: [
      row("row-1", { es: { reviewed: true, pleaseCheck: true } }),
      row("row-2", { es: { reviewed: false, pleaseCheck: true } }),
      row("row-3", { en: { reviewed: true, pleaseCheck: false } }),
    ],
  };

  const nextState = applyEditorChapterRowsUnreviewed(chapterState, "es", ["row-1", "row-3"]);

  assert.deepEqual(nextState.rows[0].fieldStates.es, { reviewed: false, pleaseCheck: true });
  assert.deepEqual(nextState.rows[0].persistedFieldStates.es, { reviewed: false, pleaseCheck: true });
  assert.equal(nextState.rows[0].markerSaveState.status, "idle");
  assert.deepEqual(nextState.rows[1].fieldStates.es, { reviewed: false, pleaseCheck: true });
  assert.deepEqual(nextState.rows[2].fieldStates.en, { reviewed: true, pleaseCheck: false });
  assert.deepEqual([...nextState.dirtyRowIds], ["row-1"]);
  assert.equal(nextState.unreviewAllModal.isOpen, false);
});
