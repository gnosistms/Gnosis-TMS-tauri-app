import test from "node:test";
import assert from "node:assert/strict";

import {
  applyEditorChapterRowsUnreviewed,
  applyEditorChapterRowsUnreviewing,
  cancelEditorUnreviewAllModalState,
  editorChapterReviewedRowIds,
  openEditorUnreviewAllModalState,
  restoreEditorChapterRowsUnreviewing,
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

function chapterWithRows(rows, overrides = {}) {
  return {
    ...createEditorChapterState(),
    chapterId: "chapter-1",
    languages: [{ code: "en" }, { code: "es" }],
    rows,
    ...overrides,
  };
}

function savingReviewedToggle(languageCode) {
  return {
    markerSaveState: { status: "saving", languageCode, kind: "reviewed", error: "" },
  };
}

test("editorChapterReviewedRowIds lists rows whose visible marker is reviewed", () => {
  const chapterState = chapterWithRows([
    row("row-1", { es: { reviewed: true, pleaseCheck: false } }),
    row("row-2", { es: { reviewed: false, pleaseCheck: true } }),
    row("row-3", { en: { reviewed: true, pleaseCheck: false } }),
    row("row-4", { es: { reviewed: true, pleaseCheck: false } }, { lifecycleState: "deleted" }),
  ]);

  assert.deepEqual(editorChapterReviewedRowIds(chapterState, "es"), ["row-1", "row-4"]);
  assert.deepEqual(editorChapterReviewedRowIds(chapterState, "fr"), []);
});

test("applyEditorChapterRowsUnreviewing clears only the visible marker and closes the modal", () => {
  const chapterState = chapterWithRows([
    row("row-1", { es: { reviewed: true, pleaseCheck: true } }),
    row("row-2", { es: { reviewed: true, pleaseCheck: false } }),
  ], {
    unreviewAllModal: {
      ...createEditorChapterState().unreviewAllModal,
      isOpen: true,
      languageCode: "es",
    },
  });

  const nextState = applyEditorChapterRowsUnreviewing(chapterState, "es", ["row-1"]);

  assert.deepEqual(nextState.rows[0].fieldStates.es, { reviewed: false, pleaseCheck: true });
  assert.deepEqual(nextState.rows[0].persistedFieldStates.es, { reviewed: true, pleaseCheck: true });
  assert.equal(nextState.rows[1], chapterState.rows[1]);
  assert.equal(nextState.unreviewAllModal.isOpen, false);
});

test("applyEditorChapterRowsUnreviewed settles every row and preserves please-check", () => {
  const chapterState = chapterWithRows([
    row("row-1", { es: { reviewed: false, pleaseCheck: true } }, {
      persistedFieldStates: { es: { reviewed: true, pleaseCheck: true } },
    }),
    row("row-2", { es: { reviewed: true, pleaseCheck: true } }),
    row("row-3", { en: { reviewed: true, pleaseCheck: false } }),
  ], {
    dirtyRowIds: new Set(["row-1"]),
  });

  const nextState = applyEditorChapterRowsUnreviewed(chapterState, "es");

  assert.deepEqual(nextState.rows[0].fieldStates.es, { reviewed: false, pleaseCheck: true });
  assert.deepEqual(nextState.rows[0].persistedFieldStates.es, { reviewed: false, pleaseCheck: true });
  assert.deepEqual(nextState.rows[1].fieldStates.es, { reviewed: false, pleaseCheck: true });
  assert.deepEqual(nextState.rows[1].persistedFieldStates.es, { reviewed: false, pleaseCheck: true });
  assert.equal(nextState.rows[2], chapterState.rows[2]);
  assert.deepEqual([...nextState.dirtyRowIds], ["row-1"]);
});

test("applyEditorChapterRowsUnreviewed keeps a reviewed toggle queued after the batch", () => {
  const chapterState = chapterWithRows([
    row("row-1", { es: { reviewed: true, pleaseCheck: false } }, {
      persistedFieldStates: { es: { reviewed: true, pleaseCheck: false } },
      ...savingReviewedToggle("es"),
    }),
  ]);

  const nextState = applyEditorChapterRowsUnreviewed(chapterState, "es");

  assert.deepEqual(nextState.rows[0].fieldStates.es, { reviewed: true, pleaseCheck: false });
  assert.deepEqual(nextState.rows[0].persistedFieldStates.es, { reviewed: false, pleaseCheck: false });
  assert.equal(nextState.rows[0].markerSaveState.status, "saving");
});

test("restoreEditorChapterRowsUnreviewing puts back the persisted marker unless toggled again", () => {
  const unreviewed = { es: { reviewed: false, pleaseCheck: false } };
  const reviewedOnDisk = { es: { reviewed: true, pleaseCheck: false } };
  const chapterState = chapterWithRows([
    row("row-1", unreviewed, { persistedFieldStates: reviewedOnDisk }),
    row("row-2", { es: { reviewed: true, pleaseCheck: false } }, {
      persistedFieldStates: reviewedOnDisk,
      ...savingReviewedToggle("es"),
    }),
    row("row-3", unreviewed, { persistedFieldStates: reviewedOnDisk }),
  ]);

  const nextState = restoreEditorChapterRowsUnreviewing(chapterState, "es", ["row-1", "row-2"]);

  assert.deepEqual(nextState.rows[0].fieldStates.es, { reviewed: true, pleaseCheck: false });
  assert.equal(nextState.rows[1], chapterState.rows[1]);
  assert.equal(nextState.rows[2], chapterState.rows[2]);
});

test("applyEditorChapterRowsUnreviewed only clears the selected duplicate-base column", () => {
  const chapterState = {
    ...createEditorChapterState(),
    chapterId: "chapter-1",
    languages: [
      { code: "zh-Hans", name: "Chinese 1", role: "target", baseCode: "zh-Hans" },
      { code: "zh-Hans-x-2", name: "Chinese 2", role: "target", baseCode: "zh-Hans" },
    ],
    rows: [
      row("row-1", {
        "zh-Hans": { reviewed: true, pleaseCheck: false },
        "zh-Hans-x-2": { reviewed: true, pleaseCheck: true },
      }),
    ],
  };

  const nextState = applyEditorChapterRowsUnreviewed(chapterState, "zh-Hans-x-2");

  assert.deepEqual(nextState.rows[0].fieldStates["zh-Hans"], { reviewed: true, pleaseCheck: false });
  assert.deepEqual(nextState.rows[0].fieldStates["zh-Hans-x-2"], { reviewed: false, pleaseCheck: true });
});
