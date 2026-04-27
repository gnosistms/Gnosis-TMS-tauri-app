import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEditorHistoryViewModel,
  editorHistoryEntryMatchesSection,
  findEditorHistoryPreviousEntry,
  findEditorHistoryPreviousCommitEntry,
  findEditorHistoryPreviousVisibleEntry,
  historyEntryCanUndoReplace,
  historyLastUpdateLabel,
  reconcileExpandedEditorHistoryGroupKeys,
} from "./editor-history.js";

function historyEntry({
  commitSha,
  authorName = "gnosistms",
  operationType = "editor-update",
  aiModel = null,
  plainText = "text",
  footnote = "",
  imageCaption = "",
  textStyle = "paragraph",
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
    aiModel,
    plainText,
    footnote,
    imageCaption,
    textStyle,
    reviewed,
    pleaseCheck,
  };
}

test("historyLastUpdateLabel labels imports as file import", () => {
  assert.equal(historyLastUpdateLabel(historyEntry({ commitSha: "c1", operationType: "import" })), "file import");
  assert.equal(historyLastUpdateLabel(historyEntry({ commitSha: "c2", authorName: "sirhans" })), "sirhans");
  assert.equal(
    historyLastUpdateLabel(historyEntry({ commitSha: "c3", authorName: "sirhans", aiModel: "gpt-5.4" })),
    "GPT 5.4 - sirhans",
  );
});

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

test("current-entry matching requires text, marker state, and style equality", () => {
  const entry = historyEntry({
    commitSha: "c1",
    plainText: "Hello",
    textStyle: "heading2",
    reviewed: true,
    pleaseCheck: false,
  });

  assert.equal(
    editorHistoryEntryMatchesSection(entry, {
      text: "Hello",
      footnote: "",
      textStyle: "heading2",
      reviewed: true,
      pleaseCheck: false,
    }),
    true,
  );
  assert.equal(
    editorHistoryEntryMatchesSection(entry, {
      text: "Hello",
      footnote: "",
      textStyle: "paragraph",
      reviewed: false,
      pleaseCheck: false,
    }),
    false,
  );
});

test("current-entry matching also requires footnote equality", () => {
  const entry = historyEntry({
    commitSha: "c1",
    plainText: "Hello",
    footnote: "Note",
  });

  assert.equal(
    editorHistoryEntryMatchesSection(entry, {
      text: "Hello",
      footnote: "Note",
      textStyle: "paragraph",
      reviewed: false,
      pleaseCheck: false,
    }),
    true,
  );
  assert.equal(
    editorHistoryEntryMatchesSection(entry, {
      text: "Hello",
      footnote: "",
      textStyle: "paragraph",
      reviewed: false,
      pleaseCheck: false,
    }),
    false,
  );
});

test("current-entry matching also requires image caption equality", () => {
  const entry = historyEntry({
    commitSha: "c1",
    plainText: "Hello",
    imageCaption: "Figure note",
  });

  assert.equal(
    editorHistoryEntryMatchesSection(entry, {
      text: "Hello",
      footnote: "",
      imageCaption: "Figure note",
      textStyle: "paragraph",
      reviewed: false,
      pleaseCheck: false,
    }),
    true,
  );
  assert.equal(
    editorHistoryEntryMatchesSection(entry, {
      text: "Hello",
      footnote: "",
      imageCaption: "",
      textStyle: "paragraph",
      reviewed: false,
      pleaseCheck: false,
    }),
    false,
  );
});

test("image-caption-only history updates stay visible instead of collapsing as marker-only changes", () => {
  const model = buildEditorHistoryViewModel([
    historyEntry({ commitSha: "c2", plainText: "Hello", imageCaption: "Figure note" }),
    historyEntry({ commitSha: "c1", operationType: "import", plainText: "Hello", imageCaption: "" }),
  ], new Set(["c1"]));

  assert.equal(model.groups.length, 2);
  assert.equal(model.groups[0].entries[0].commitSha, "c2");
  assert.equal(model.groups[1].entries[0].commitSha, "c1");
});

test("style-only history updates stay visible instead of collapsing as marker-only changes", () => {
  const model = buildEditorHistoryViewModel([
    historyEntry({ commitSha: "c3", textStyle: "paragraph" }),
    historyEntry({ commitSha: "c2", textStyle: "heading1" }),
    historyEntry({ commitSha: "c1", operationType: "import", textStyle: "paragraph" }),
  ], new Set(["c1"]));

  assert.equal(model.groups.length, 2);
  assert.equal(model.groups[0].entries.length, 2);
  assert.equal(model.groups[0].entries[0].commitSha, "c3");
  assert.equal(model.groups[0].entries[1].commitSha, "c2");
  assert.equal(model.groups[1].entries[0].commitSha, "c1");
});

test("footnote-only history updates stay visible instead of collapsing as marker-only changes", () => {
  const model = buildEditorHistoryViewModel([
    historyEntry({ commitSha: "c2", plainText: "Hello", footnote: "Note" }),
    historyEntry({ commitSha: "c1", operationType: "import", plainText: "Hello", footnote: "" }),
  ], new Set(["c1"]));

  assert.equal(model.groups.length, 2);
  assert.equal(model.groups[0].entries[0].commitSha, "c2");
  assert.equal(model.groups[1].entries[0].commitSha, "c1");
});

test("AI translation history groups use the model and author as the effective author label", () => {
  const model = buildEditorHistoryViewModel([
    historyEntry({ commitSha: "c4", authorName: "sirhans", operationType: "ai-translation", aiModel: "gpt-5.4" }),
    historyEntry({ commitSha: "c3", authorName: "sirhans", operationType: "ai-translation", aiModel: "gpt-5.4" }),
    historyEntry({ commitSha: "c2", authorName: "sirhans", operationType: "editor-update" }),
    historyEntry({ commitSha: "c1", operationType: "import" }),
  ], new Set());

  assert.equal(model.groups.length, 3);
  assert.equal(model.groups[0].authorName, "GPT 5.4 - sirhans");
  assert.equal(model.groups[0].entries.length, 2);
  assert.equal(model.groups[1].authorName, "sirhans");
  assert.equal(model.groups[1].entries.length, 1);
  assert.equal(model.groups[2].authorName, "Import file");
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

test("findEditorHistoryPreviousEntry returns the previous saved version for the current section", () => {
  const entries = [
    historyEntry({ commitSha: "c3", plainText: "Current" }),
    historyEntry({ commitSha: "c2", plainText: "Previous" }),
    historyEntry({ commitSha: "c1", operationType: "import", plainText: "Initial" }),
  ];

  assert.equal(
    findEditorHistoryPreviousEntry(entries, {
      text: "Current",
      footnote: "",
      textStyle: "paragraph",
      reviewed: false,
      pleaseCheck: false,
    })?.commitSha,
    "c2",
  );

  assert.equal(
    findEditorHistoryPreviousEntry(entries, {
      text: "Unsaved change",
      footnote: "",
      textStyle: "paragraph",
      reviewed: false,
      pleaseCheck: false,
    })?.commitSha,
    "c3",
  );
});

test("findEditorHistoryPreviousEntry treats style-only changes as distinct saved versions", () => {
  const entries = [
    historyEntry({ commitSha: "c2", textStyle: "heading1" }),
    historyEntry({ commitSha: "c1", operationType: "import", textStyle: "paragraph" }),
  ];

  assert.equal(
    findEditorHistoryPreviousEntry(entries, {
      text: "text",
      footnote: "",
      textStyle: "heading1",
      reviewed: false,
      pleaseCheck: false,
    })?.commitSha,
    "c1",
  );
});

test("findEditorHistoryPreviousCommitEntry returns the immediately previous commit", () => {
  const entries = [
    historyEntry({ commitSha: "c3", plainText: "Hello", footnote: "Note", textStyle: "heading1" }),
    historyEntry({ commitSha: "c2", plainText: "Hello", footnote: "", textStyle: "heading1" }),
    historyEntry({ commitSha: "c1", operationType: "import", plainText: "Hello", footnote: "", textStyle: "paragraph" }),
  ];

  assert.equal(findEditorHistoryPreviousCommitEntry(entries)?.commitSha, "c2");
});

test("findEditorHistoryPreviousVisibleEntry compares against the prior visible revision in collapsed history", () => {
  const entries = [
    historyEntry({ commitSha: "c3", plainText: "Hello", footnote: "Note", textStyle: "heading1" }),
    historyEntry({ commitSha: "c2", plainText: "Hello", footnote: "", textStyle: "heading1" }),
    historyEntry({ commitSha: "c1", operationType: "import", plainText: "Hello", footnote: "", textStyle: "paragraph" }),
  ];

  assert.equal(
    findEditorHistoryPreviousVisibleEntry(entries, {
      text: "Hello",
      footnote: "Note",
      textStyle: "heading1",
      reviewed: false,
      pleaseCheck: false,
    })?.commitSha,
    "c1",
  );
});
