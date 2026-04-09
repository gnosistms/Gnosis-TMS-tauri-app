import test from "node:test";
import assert from "node:assert/strict";

import { buildEditorHistoryViewModel, editorHistoryEntryMatchesSection } from "./editor-history.js";

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
  assert.equal(collapsedModel.groups[0].entries[0].statusNote, 'Marked "Please check"');
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
