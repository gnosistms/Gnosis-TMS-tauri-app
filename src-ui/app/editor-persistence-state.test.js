import test from "node:test";
import assert from "node:assert/strict";

import {
  applyEditorConflictResolutionSavedLocally,
  applyEditorRowFieldValue,
  applyEditorRowMarkerSaved,
  applyEditorRowMarkerSaveFailed,
  applyEditorRowMarkerSaving,
  applyEditorRowPersistFailed,
  applyEditorRowPersistQueuedWhileSaving,
  applyEditorRowPersistRequested,
  applyEditorRowPersistReset,
  applyEditorRowPersistSucceeded,
} from "./editor-persistence-state.js";

function row(overrides = {}) {
  return {
    rowId: "row-1",
    fields: { es: "uno" },
    persistedFields: { es: "uno" },
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
    ...overrides,
  };
}

function persistedPayload(overrides = {}) {
  return {
    rowId: "row-1",
    fields: { es: "dos" },
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
  );

  assert.deepEqual(updatedRow.persistedFields, { es: "dos" });
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
  );

  assert.deepEqual(updatedRow.fields, { es: "resolved local" });
  assert.deepEqual(updatedRow.persistedFields, { es: "resolved local" });
  assert.equal(updatedRow.saveStatus, "conflict");
  assert.equal(updatedRow.freshness, "conflict");
  assert.deepEqual(updatedRow.conflictState.remoteRow.fields, { es: "remote old" });
  assert.equal(updatedRow.conflictState.remoteVersion.authorName, "The Octocat");
});
