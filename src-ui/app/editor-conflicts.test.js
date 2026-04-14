import test from "node:test";
import assert from "node:assert/strict";

import {
  conflictedLanguageCodesForRow,
  editorChapterHasUnresolvedConflicts,
  rowHasUnresolvedEditorConflict,
} from "./editor-conflicts.js";

test("rowHasUnresolvedEditorConflict recognizes editor merge-conflict rows", () => {
  assert.equal(rowHasUnresolvedEditorConflict({ freshness: "conflict" }), true);
  assert.equal(rowHasUnresolvedEditorConflict({ saveStatus: "conflict" }), true);
  assert.equal(rowHasUnresolvedEditorConflict({ hasConflict: true }), true);
  assert.equal(rowHasUnresolvedEditorConflict({
    freshness: "fresh",
    saveStatus: "idle",
    conflictState: { remoteRow: { fields: { en: "remote" } } },
  }), true);
  assert.equal(rowHasUnresolvedEditorConflict({ freshness: "fresh", saveStatus: "idle" }), false);
});

test("conflictedLanguageCodesForRow returns the languages that differ from the GitHub version", () => {
  const codes = conflictedLanguageCodesForRow(
    {
      fields: {
        es: "uno",
        en: "one local",
        vi: "mot local",
      },
      conflictState: {
        remoteRow: {
          fields: {
            es: "uno",
            en: "one github",
            vi: "mot local",
          },
        },
      },
    },
    [{ code: "es" }, { code: "en" }, { code: "vi" }],
  );

  assert.deepEqual([...codes], ["en"]);
});

test("editorChapterHasUnresolvedConflicts checks the chapter rows", () => {
  assert.equal(editorChapterHasUnresolvedConflicts({
    rows: [
      { rowId: "row-1", freshness: "fresh" },
      { rowId: "row-2", saveStatus: "conflict" },
    ],
  }), true);
  assert.equal(editorChapterHasUnresolvedConflicts({
    rows: [{ rowId: "row-1", freshness: "fresh", saveStatus: "idle" }],
  }), false);
});
