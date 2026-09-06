import test from "node:test";
import assert from "node:assert/strict";

import {
  editorRowChangedLanguageCodes,
  reconcileDirtyRowIds,
  resolveDirtyTrackedEditorRowIds,
  rowHasPersistedChanges,
  rowNeedsDirtyTracking,
} from "./editor-row-persistence-model.js";

function row(rowId, overrides = {}) {
  return {
    rowId,
    fields: { es: "uno" },
    persistedFields: { es: "uno" },
    fieldStates: { es: { reviewed: false, pleaseCheck: false } },
    persistedFieldStates: { es: { reviewed: false, pleaseCheck: false } },
    saveStatus: "idle",
    markerSaveState: { status: "idle", languageCode: null, kind: null, error: "" },
    textStyleSaveState: { status: "idle", error: "" },
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

test("row text style saves keep the row dirty-tracked while saving", () => {
  const styleSavingRow = row("row-a", {
    textStyleSaveState: { status: "saving", error: "" },
  });

  assert.equal(rowNeedsDirtyTracking(styleSavingRow), true);
});

test("editorRowChangedLanguageCodes lists only columns whose text differs from the persisted values", () => {
  const changed = editorRowChangedLanguageCodes(
    row("row-1", {
      fields: { es: "uno", en: "one", vi: "" },
      persistedFields: { es: "uno", en: "", vi: "" },
      footnotes: { vi: [{ marker: 1, text: "note" }] },
      persistedFootnotes: { vi: [] },
      imageCaptions: { es: "cap" },
      persistedImageCaptions: { es: "cap" },
    }),
  );
  assert.deepEqual([...changed].sort(), ["en", "vi"]);

  // Without persisted tracking every column counts as changed.
  assert.deepEqual(
    [...editorRowChangedLanguageCodes({ fields: { es: "uno", en: "one" } })].sort(),
    ["en", "es"],
  );
});
