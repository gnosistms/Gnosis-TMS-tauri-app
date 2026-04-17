import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEditorConflictResolutionModalState,
  buildEditorConflictResolutionSaveState,
  buildEditorConflictResolutionVersionCopyText,
  editorConflictResolutionShowsFootnotes,
} from "./editor-conflict-resolution-model.js";

function buildConflictRow(overrides = {}) {
  return {
    rowId: "row-1",
    fields: {
      es: "Hola",
    },
    footnotes: {
      es: "Local note",
    },
    conflictState: {
      remoteRow: {
        fields: {
          es: "Hola",
        },
        footnotes: {
          es: "Remote note",
        },
      },
      remoteVersion: {
        authorName: "Octocat",
        committedAt: "2026-04-17T10:00:00Z",
      },
    },
    ...overrides,
  };
}

test("buildEditorConflictResolutionModalState includes footnotes and defaults the final footnote to GitHub", () => {
  const modal = buildEditorConflictResolutionModalState(buildConflictRow(), "es");

  assert.equal(modal.localText, "Hola");
  assert.equal(modal.remoteText, "Hola");
  assert.equal(modal.finalText, "Hola");
  assert.equal(modal.localFootnote, "Local note");
  assert.equal(modal.remoteFootnote, "Remote note");
  assert.equal(modal.finalFootnote, "Remote note");
});

test("buildEditorConflictResolutionSaveState persists the chosen final footnote", () => {
  const saveState = buildEditorConflictResolutionSaveState(
    buildConflictRow(),
    "es",
    {
      finalText: "Hola final",
      finalFootnote: "Chosen note",
    },
  );

  assert.equal(saveState.nextLocalFields.es, "Hola final");
  assert.equal(saveState.nextLocalFootnotes.es, "Chosen note");
  assert.equal(saveState.fieldsToPersist.es, "Hola final");
  assert.equal(saveState.footnotesToPersist.es, "Chosen note");
});

test("editorConflictResolutionShowsFootnotes stays true for footnote-only conflicts", () => {
  const modal = buildEditorConflictResolutionModalState(buildConflictRow(), "es");

  assert.equal(editorConflictResolutionShowsFootnotes(modal), true);
});

test("buildEditorConflictResolutionVersionCopyText includes the footnote text", () => {
  const modal = buildEditorConflictResolutionModalState(buildConflictRow(), "es");

  assert.equal(
    buildEditorConflictResolutionVersionCopyText(modal, "remote"),
    "Hola\n\nRemote note",
  );
});
