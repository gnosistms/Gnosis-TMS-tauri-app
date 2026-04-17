import test from "node:test";
import assert from "node:assert/strict";

import {
  reconcileDirtyRowIds,
  resolveDirtyTrackedEditorRowIds,
  reviewTabLanguageToOpenAfterSave,
  rowHasContentChanges,
  rowHasPersistedChanges,
  rowNeedsDirtyTracking,
} from "./editor-row-persistence-model.js";
import { createEditorChapterState } from "./state.js";

function row(rowId, overrides = {}) {
  return {
    rowId,
    textStyle: "paragraph",
    persistedTextStyle: "paragraph",
    fields: { es: "uno" },
    persistedFields: { es: "uno" },
    fieldStates: { es: { reviewed: false, pleaseCheck: false } },
    persistedFieldStates: { es: { reviewed: false, pleaseCheck: false } },
    saveStatus: "idle",
    markerSaveState: { status: "idle", languageCode: null, kind: null, error: "" },
    ...overrides,
  };
}

test("focus-in dirty-row scans exclude the newly focused row", () => {
  const dirtyRowIds = new Set(["row-a", "row-b"]);

  const candidateRowIds = resolveDirtyTrackedEditorRowIds(dirtyRowIds, {
    excludeRowId: "row-b",
  });

  assert.deepEqual(candidateRowIds, ["row-a"]);
});

test("targeted dirty-row scans keep only requested dirty rows", () => {
  const dirtyRowIds = new Set(["row-a", "row-b"]);

  const candidateRowIds = resolveDirtyTrackedEditorRowIds(dirtyRowIds, {
    rowIds: ["row-b", "row-c"],
  });

  assert.deepEqual(candidateRowIds, ["row-b"]);
});

test("rows reverted to persisted text reconcile out of the dirty set", () => {
  const nextDirtyRowIds = reconcileDirtyRowIds(
    [row("row-a")],
    new Set(["row-a"]),
    ["row-a"],
  );

  assert.deepEqual([...nextDirtyRowIds], []);
});

test("marker-only pending work stays dirty until persistence catches up", () => {
  const pendingMarkerRow = row("row-a", {
    fieldStates: { es: { reviewed: true, pleaseCheck: false } },
    persistedFieldStates: { es: { reviewed: false, pleaseCheck: false } },
  });

  assert.equal(rowHasPersistedChanges(pendingMarkerRow), true);
  assert.equal(rowNeedsDirtyTracking(pendingMarkerRow), true);

  const nextDirtyRowIds = reconcileDirtyRowIds(
    [pendingMarkerRow],
    new Set(["row-a"]),
    ["row-a"],
  );

  assert.deepEqual([...nextDirtyRowIds], ["row-a"]);
});

test("text-style-only pending work stays dirty until persistence catches up", () => {
  const pendingStyleRow = row("row-a", {
    textStyle: "heading1",
    persistedTextStyle: "paragraph",
  });

  assert.equal(rowHasContentChanges(pendingStyleRow), true);
  assert.equal(rowHasPersistedChanges(pendingStyleRow), true);
  assert.equal(rowNeedsDirtyTracking(pendingStyleRow), true);

  const nextDirtyRowIds = reconcileDirtyRowIds(
    [pendingStyleRow],
    new Set(["row-a"]),
    ["row-a"],
  );

  assert.deepEqual([...nextDirtyRowIds], ["row-a"]);
});

test("saving rows remain dirty-tracked while the save is in flight", () => {
  const savingRow = row("row-a", {
    saveStatus: "saving",
  });

  assert.equal(rowNeedsDirtyTracking(savingRow), true);

  const nextDirtyRowIds = reconcileDirtyRowIds(
    [savingRow],
    new Set(),
    ["row-a"],
  );

  assert.deepEqual([...nextDirtyRowIds], ["row-a"]);
});

test("reviewTabLanguageToOpenAfterSave opens review for a newly saved non-source translation", () => {
  const chapterState = {
    ...createEditorChapterState(),
    chapterId: "chapter-1",
    activeRowId: "row-a",
    activeLanguageCode: "vi",
    selectedSourceLanguageCode: "es",
  };
  const currentRow = row("row-a", {
    fields: { es: "Hola", vi: "" },
    persistedFields: { es: "Hola", vi: "" },
  });

  assert.equal(
    reviewTabLanguageToOpenAfterSave(chapterState, "row-a", currentRow, {
      es: "Hola",
      vi: "Xin chao",
    }),
    "vi",
  );
});

test("reviewTabLanguageToOpenAfterSave stays off for source-language saves", () => {
  const chapterState = {
    ...createEditorChapterState(),
    chapterId: "chapter-1",
    activeRowId: "row-a",
    activeLanguageCode: "es",
    selectedSourceLanguageCode: "es",
  };
  const currentRow = row("row-a", {
    fields: { es: "", vi: "" },
    persistedFields: { es: "", vi: "" },
  });

  assert.equal(
    reviewTabLanguageToOpenAfterSave(chapterState, "row-a", currentRow, {
      es: "Hola",
      vi: "",
    }),
    null,
  );
});

test("reviewTabLanguageToOpenAfterSave stays off when editing an existing translation", () => {
  const chapterState = {
    ...createEditorChapterState(),
    chapterId: "chapter-1",
    activeRowId: "row-a",
    activeLanguageCode: "vi",
    selectedSourceLanguageCode: "es",
  };
  const currentRow = row("row-a", {
    fields: { es: "Hola", vi: "Xin chao" },
    persistedFields: { es: "Hola", vi: "Xin chao" },
  });

  assert.equal(
    reviewTabLanguageToOpenAfterSave(chapterState, "row-a", currentRow, {
      es: "Hola",
      vi: "Xin chao ban",
    }),
    null,
  );
});

test("reviewTabLanguageToOpenAfterSave stays off when the saved row is not active", () => {
  const chapterState = {
    ...createEditorChapterState(),
    chapterId: "chapter-1",
    activeRowId: "row-b",
    activeLanguageCode: "vi",
    selectedSourceLanguageCode: "es",
  };
  const currentRow = row("row-a", {
    fields: { es: "Hola", vi: "" },
    persistedFields: { es: "Hola", vi: "" },
  });

  assert.equal(
    reviewTabLanguageToOpenAfterSave(chapterState, "row-a", currentRow, {
      es: "Hola",
      vi: "Xin chao",
    }),
    null,
  );
});
