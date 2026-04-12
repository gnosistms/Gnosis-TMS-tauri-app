import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEditorHistoryViewModel,
  editorHistoryEntryMatchesSection,
  historyEntryCanUndoReplace,
  reconcileExpandedEditorHistoryGroupKeys,
} from "./editor-history.js";

function historyEntry({
  commitSha,
  authorName = "gnosistms",
  operationType = "editor-update",
  plainText = "text",
  reviewed = false,
  pleaseCheck = false,
  statusNote = null,
}) {
  return {
    commitSha,
    authorName,
    committedAt: "2026-04-09T00:00:00Z",
    message: "Update row",
    operationType,
    statusNote,
    plainText,
    reviewed,
    pleaseCheck,
  };
}

test("marker-only runs that return to the baseline state disappear from grouped history", () => {
  const model = buildEditorHistoryViewModel([
    historyEntry({ commitSha: "c3", pleaseCheck: false, operationType: "field-status", statusNote: 'Removed "Please check"' }),
    historyEntry({ commitSha: "c2", pleaseCheck: true, operationType: "field-status", statusNote: 'Marked "Please check"' }),
    historyEntry({ commitSha: "c1", operationType: "import" }),
  ], new Set());

  assert.equal(model.groups.length, 1);
  assert.equal(model.groups[0].entries.length, 1);
  assert.equal(model.groups[0].entries[0].commitSha, "c1");
});

test("marker-only runs collapse to the final net state within a same-author group", () => {
  const collapsedModel = buildEditorHistoryViewModel([
    historyEntry({ commitSha: "c4", reviewed: false, pleaseCheck: true, operationType: "field-status", statusNote: "Marked unreviewed" }),
    historyEntry({ commitSha: "c3", reviewed: true, pleaseCheck: true, operationType: "field-status", statusNote: 'Marked "Please check"' }),
    historyEntry({ commitSha: "c2", reviewed: true, pleaseCheck: false, operationType: "field-status", statusNote: "Marked reviewed" }),
    historyEntry({ commitSha: "c1", reviewed: false, pleaseCheck: false, operationType: "editor-update" }),
  ], new Set());

  assert.equal(collapsedModel.groups.length, 1);
  assert.equal(collapsedModel.groups[0].entries.length, 2);
  assert.equal(collapsedModel.groups[0].entries[0].commitSha, "c4");
  assert.deepEqual(collapsedModel.groups[0].entries[0].markerNoteActions, [
    {
      kind: "please-check",
      enabled: true,
    },
  ]);
  assert.equal(collapsedModel.groups[0].entries[1].commitSha, "c1");
});

test("current-entry matching requires text and marker state equality", () => {
  const entry = historyEntry({
    commitSha: "c1",
    plainText: "Hello",
    reviewed: true,
    pleaseCheck: false,
  });

  assert.equal(
    editorHistoryEntryMatchesSection(entry, {
      text: "Hello",
      reviewed: true,
      pleaseCheck: false,
    }),
    true,
  );
  assert.equal(
    editorHistoryEntryMatchesSection(entry, {
      text: "Hello",
      reviewed: false,
      pleaseCheck: false,
    }),
    false,
  );
});

test("expanded history groups stay expanded when new entries are added to the same author run", () => {
  const previousEntries = [
    historyEntry({ commitSha: "c3", plainText: "Newest" }),
    historyEntry({ commitSha: "c2", plainText: "Older" }),
    historyEntry({ commitSha: "c1", authorName: "another-user", plainText: "Baseline" }),
  ];
  const previousModel = buildEditorHistoryViewModel(previousEntries, new Set());

  const nextEntries = [
    historyEntry({ commitSha: "c4", plainText: "Newest plus one" }),
    historyEntry({ commitSha: "c3", plainText: "Newest" }),
    historyEntry({ commitSha: "c2", plainText: "Older" }),
    historyEntry({ commitSha: "c1", authorName: "another-user", plainText: "Baseline" }),
  ];

  const reconciledKeys = reconcileExpandedEditorHistoryGroupKeys(
    previousEntries,
    nextEntries,
    new Set([previousModel.groups[0].key]),
  );
  const nextModel = buildEditorHistoryViewModel(nextEntries, reconciledKeys);

  assert.equal(nextModel.groups.length, 2);
  assert.equal(nextModel.groups[0].entries.length, 3);
  assert.equal(reconciledKeys.has(nextModel.groups[0].key), true);
});

test("only editor-replace history entries expose undo replace", () => {
  assert.equal(historyEntryCanUndoReplace(historyEntry({ commitSha: "c1", operationType: "editor-replace" })), true);
  assert.equal(historyEntryCanUndoReplace(historyEntry({ commitSha: "c2", operationType: "editor-update" })), false);
  assert.equal(historyEntryCanUndoReplace(historyEntry({ commitSha: "c3", operationType: "restore" })), false);
});
