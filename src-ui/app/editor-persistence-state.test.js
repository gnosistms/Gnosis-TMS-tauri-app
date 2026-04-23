import test from "node:test";
import assert from "node:assert/strict";

import {
  applyEditorConflictResolutionSavedLocally,
  applyEditorRowFieldValue,
  applyEditorRowMergedWithRemote,
  applyEditorRowMarkerSaved,
  applyEditorRowMarkerSaveFailed,
  applyEditorRowMarkerSaving,
  applyEditorRowPersistFailed,
  applyEditorRowPersistQueuedWhileSaving,
  applyEditorRowPersistRequested,
  applyEditorRowPersistReset,
  applyEditorRowPersistSucceeded,
  applyEditorRowTextStyleSaved,
  applyEditorRowTextStyleSaveFailed,
  applyEditorRowTextStyleSaving,
} from "./editor-persistence-state.js";

function row(overrides = {}) {
  return {
    rowId: "row-1",
    textStyle: "paragraph",
    fields: { es: "uno" },
    footnotes: { es: "" },
    imageCaptions: { es: "" },
    persistedFields: { es: "uno" },
    persistedFootnotes: { es: "" },
    persistedImageCaptions: { es: "" },
    images: {},
    persistedImages: {},
    fieldStates: { es: { reviewed: false, pleaseCheck: false } },
    persistedFieldStates: { es: { reviewed: false, pleaseCheck: false } },
    saveStatus: "idle",
    saveError: "",
    markerSaveState: {
      status: "idle",
      languageCode: null,
      kind: null,
      error: "",
    },
    textStyleSaveState: {
      status: "idle",
      error: "",
    },
    ...overrides,
  };
}

function persistedPayload(overrides = {}) {
  return {
    rowId: "row-1",
    textStyle: "paragraph",
    fields: { es: "dos" },
    footnotes: { es: "" },
    imageCaptions: { es: "" },
    images: {},
    fieldStates: { es: { reviewed: false, pleaseCheck: false } },
    ...overrides,
  };
}

test("applyEditorRowFieldValue marks a changed row dirty", () => {
  const updatedRow = applyEditorRowFieldValue(row(), "es", "dos");

  assert.equal(updatedRow.fields.es, "dos");
  assert.equal(updatedRow.saveStatus, "dirty");
  assert.equal(updatedRow.saveError, "");
});

test("applyEditorRowFieldValue returns to idle when the value matches persisted text", () => {
  const updatedRow = applyEditorRowFieldValue(row({ saveStatus: "error", saveError: "bad" }), "es", "uno");

  assert.equal(updatedRow.saveStatus, "idle");
  assert.equal(updatedRow.saveError, "");
});

test("applyEditorRowFieldValue keeps a currently saving row dirty", () => {
  const updatedRow = applyEditorRowFieldValue(row({ saveStatus: "saving" }), "es", "dos");

  assert.equal(updatedRow.saveStatus, "dirty");
});

test("applyEditorRowMarkerSaving stores optimistic marker state and saving metadata", () => {
  const updatedRow = applyEditorRowMarkerSaving(row(), "es", "reviewed", {
    reviewed: true,
    pleaseCheck: false,
  });

  assert.equal(updatedRow.fieldStates.es.reviewed, true);
  assert.equal(updatedRow.markerSaveState.status, "saving");
  assert.equal(updatedRow.markerSaveState.languageCode, "es");
  assert.equal(updatedRow.markerSaveState.kind, "reviewed");
});

test("applyEditorRowMarkerSaved syncs current and persisted marker state", () => {
  const updatedRow = applyEditorRowMarkerSaved(
    applyEditorRowMarkerSaving(row(), "es", "reviewed", { reviewed: true, pleaseCheck: false }),
    "es",
    { reviewed: true, pleaseCheck: true },
  );

  assert.deepEqual(updatedRow.fieldStates.es, { reviewed: true, pleaseCheck: true });
  assert.deepEqual(updatedRow.persistedFieldStates.es, { reviewed: true, pleaseCheck: true });
  assert.equal(updatedRow.markerSaveState.status, "idle");
});

test("applyEditorRowMarkerSaveFailed restores the previous marker state and stores the error", () => {
  const updatedRow = applyEditorRowMarkerSaveFailed(
    applyEditorRowMarkerSaving(row(), "es", "please-check", { reviewed: false, pleaseCheck: true }),
    "es",
    { reviewed: false, pleaseCheck: false },
    "save failed",
  );

  assert.deepEqual(updatedRow.fieldStates.es, { reviewed: false, pleaseCheck: false });
  assert.equal(updatedRow.markerSaveState.status, "idle");
  assert.equal(updatedRow.markerSaveState.error, "save failed");
});

test("applyEditorRowTextStyleSaving stores the optimistic text style", () => {
  const updatedRow = applyEditorRowTextStyleSaving(row(), "heading1");

  assert.equal(updatedRow.textStyle, "heading1");
  assert.equal(updatedRow.textStyleSaveState.status, "saving");
});

test("applyEditorRowTextStyleSaved clears the row text style save state", () => {
  const updatedRow = applyEditorRowTextStyleSaved(
    applyEditorRowTextStyleSaving(row(), "heading1"),
    "heading1",
  );

  assert.equal(updatedRow.textStyle, "heading1");
  assert.equal(updatedRow.textStyleSaveState.status, "idle");
});

test("applyEditorRowTextStyleSaveFailed restores the previous row text style", () => {
  const updatedRow = applyEditorRowTextStyleSaveFailed(
    applyEditorRowTextStyleSaving(row(), "quote"),
    "paragraph",
    "save failed",
  );

  assert.equal(updatedRow.textStyle, "paragraph");
  assert.equal(updatedRow.textStyleSaveState.status, "idle");
  assert.equal(updatedRow.textStyleSaveState.error, "save failed");
});

test("applyEditorRowPersistRequested clears prior save errors", () => {
  const updatedRow = applyEditorRowPersistRequested(row({ saveStatus: "error", saveError: "bad" }));

  assert.equal(updatedRow.saveStatus, "saving");
  assert.equal(updatedRow.saveError, "");
});

test("applyEditorRowPersistQueuedWhileSaving marks an in-flight row dirty", () => {
  const updatedRow = applyEditorRowPersistQueuedWhileSaving(row({ saveStatus: "saving" }));

  assert.equal(updatedRow.saveStatus, "dirty");
});

test("applyEditorRowPersistReset returns a row to idle", () => {
  const updatedRow = applyEditorRowPersistReset(row({ saveStatus: "error", saveError: "bad" }));

  assert.equal(updatedRow.saveStatus, "idle");
  assert.equal(updatedRow.saveError, "");
});

test("applyEditorRowPersistSucceeded updates persisted fields and stays idle when text matches", () => {
  const updatedRow = applyEditorRowPersistSucceeded(
    row({ fields: { es: "dos" }, saveStatus: "saving" }),
    persistedPayload(),
  );

  assert.deepEqual(updatedRow.persistedFields, { es: "dos" });
  assert.equal(updatedRow.saveStatus, "idle");
});

test("applyEditorRowPersistSucceeded stays dirty when the row changed again during save", () => {
  const updatedRow = applyEditorRowPersistSucceeded(
    row({ fields: { es: "tres" }, saveStatus: "saving" }),
    persistedPayload(),
    {
      fields: { es: "dos" },
      footnotes: { es: "" },
      imageCaptions: { es: "" },
      images: {},
    },
  );

  assert.deepEqual(updatedRow.persistedFields, { es: "dos" });
  assert.equal(updatedRow.saveStatus, "dirty");
});

test("applyEditorRowMergedWithRemote keeps local dirty text while adopting remote changes", () => {
  const updatedRow = applyEditorRowMergedWithRemote(
    row({
      fields: { es: "uno", en: "hello local" },
      footnotes: { es: "", en: "" },
      imageCaptions: { es: "", en: "" },
      images: {},
      baseFields: { es: "uno", en: "hello" },
      baseFootnotes: { es: "", en: "" },
      baseImageCaptions: { es: "", en: "" },
      baseImages: {},
    }),
    persistedPayload({
      fields: { es: "dos remoto", en: "hello" },
      fieldStates: {
        es: { reviewed: true, pleaseCheck: false },
        en: { reviewed: false, pleaseCheck: false },
      },
    }),
    {
      status: "merged",
      mergedFields: { es: "dos remoto", en: "hello local" },
      mergedFootnotes: { es: "", en: "" },
      mergedImageCaptions: { es: "", en: "" },
      mergedImages: {},
      mergedFieldStates: {
        es: { reviewed: true, pleaseCheck: false },
        en: { reviewed: false, pleaseCheck: false },
      },
    },
  );

  assert.deepEqual(updatedRow.fields, { es: "dos remoto", en: "hello local" });
  assert.deepEqual(updatedRow.persistedFields, { es: "dos remoto", en: "hello" });
  assert.equal(updatedRow.saveStatus, "dirty");
  assert.equal(updatedRow.freshness, "dirty");
});

test("applyEditorRowPersistSucceeded merges disjoint remote updates into a row that changed again during save", () => {
  const updatedRow = applyEditorRowPersistSucceeded(
    row({
      fields: { es: "uno", en: "hello local draft 2" },
      footnotes: { es: "", en: "" },
      imageCaptions: { es: "", en: "" },
      images: {},
      persistedFields: { es: "uno", en: "hello" },
      persistedFootnotes: { es: "", en: "" },
      persistedImageCaptions: { es: "", en: "" },
      persistedImages: {},
    }),
    persistedPayload({
      fields: { es: "dos remoto", en: "hello local draft 1" },
    }),
    {
      fields: { es: "uno", en: "hello local draft 1" },
      footnotes: { es: "", en: "" },
      imageCaptions: { es: "", en: "" },
      images: {},
    },
  );

  assert.deepEqual(updatedRow.fields, {
    es: "dos remoto",
    en: "hello local draft 2",
  });
  assert.deepEqual(updatedRow.persistedFields, {
    es: "dos remoto",
    en: "hello local draft 1",
  });
  assert.equal(updatedRow.saveStatus, "dirty");
});

test("applyEditorRowPersistFailed stores an error status", () => {
  const updatedRow = applyEditorRowPersistFailed(row({ saveStatus: "saving" }), "save failed");

  assert.equal(updatedRow.saveStatus, "error");
  assert.equal(updatedRow.saveError, "save failed");
});

test("applyEditorConflictResolutionSavedLocally keeps the GitHub version until sync finishes", () => {
  const updatedRow = applyEditorConflictResolutionSavedLocally(
    row({
      fields: { es: "local draft" },
      persistedFields: { es: "remote old" },
      conflictState: {
        remoteRow: {
          rowId: "row-1",
          fields: { es: "remote old" },
          fieldStates: { es: { reviewed: false, pleaseCheck: false } },
        },
        remoteVersion: {
          authorName: "The Octocat",
          committedAt: "2026-04-14T00:00:00Z",
          commitSha: "abcdef12",
        },
      },
    }),
    persistedPayload({ fields: { es: "resolved local" } }),
    { es: "resolved local" },
    { es: "" },
    { es: "" },
  );

  assert.deepEqual(updatedRow.fields, { es: "resolved local" });
  assert.deepEqual(updatedRow.persistedFields, { es: "resolved local" });
  assert.equal(updatedRow.saveStatus, "conflict");
  assert.equal(updatedRow.freshness, "conflict");
  assert.deepEqual(updatedRow.conflictState.remoteRow.fields, { es: "remote old" });
  assert.equal(updatedRow.conflictState.remoteVersion.authorName, "The Octocat");
});
