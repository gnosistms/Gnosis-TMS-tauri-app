import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEditorHistoryViewModel,
  editorHistoryEntryMatchesSection,
  findEditorHistoryPreviousEntry,
  findEditorHistoryPreviousCommitEntry,
  findEditorHistoryPreviousVisibleEntry,
  historyEntryCanUndoReplace,
  historyLastUpdateHeadingLabel,
  historyLastUpdateLabel,
  isOptimisticEditorHistoryEntry,
  reconcileExpandedEditorHistoryGroupKeys,
} from "./editor-history.js";

function historyEntry({
  commitSha,
  authorName = "gnosistms",
  authorLogin = "",
  authorEmail = "",
  operationType = "editor-update",
  aiModel = null,
  plainText = "text",
  footnote = "",
  imageCaption = "",
  attribution = "",
  image = null,
  textStyle = "paragraph",
  reviewed = false,
  pleaseCheck = false,
  statusNote = null,
}) {
  return {
    commitSha,
    authorName,
    authorLogin,
    authorEmail,
    committedAt: "2026-04-09T00:00:00Z",
    message: "Update row",
    operationType,
    statusNote,
    aiModel,
    plainText,
    footnote,
    imageCaption,
    attribution,
    image,
    textStyle,
    reviewed,
    pleaseCheck,
  };
}

test("an attribution-only edit does not mark the previous attribution as Current", () => {
  const entry = historyEntry({ commitSha: "old", plainText: "Quote", attribution: "Old author" });
  assert.equal(editorHistoryEntryMatchesSection(entry, { text: "Quote", attribution: "New author" }), false);
  assert.equal(editorHistoryEntryMatchesSection(entry, { text: "Quote", attribution: "Old author" }), true);
});

test("historyLastUpdateLabel labels imports as file import", () => {
  assert.equal(historyLastUpdateLabel(historyEntry({ commitSha: "c1", operationType: "import" })), "file import");
  assert.equal(historyLastUpdateLabel(historyEntry({ commitSha: "c2", authorName: "sirhans" })), "sirhans");
  assert.equal(
    historyLastUpdateLabel(historyEntry({ commitSha: "c3", authorName: "sirhans", aiModel: "gpt-5.4" })),
    "GPT 5.4 - sirhans",
  );
});

test("historyLastUpdateHeadingLabel names the latest updater source", () => {
  assert.equal(
    historyLastUpdateHeadingLabel(historyEntry({ commitSha: "c1", authorName: "sirhans" })),
    "Last update - sirhans",
  );
  assert.equal(
    historyLastUpdateHeadingLabel(historyEntry({ commitSha: "c2", authorName: "sirhans", aiModel: "gpt-5.4" })),
    "Last update - GPT 5.4",
  );
  assert.equal(
    historyLastUpdateHeadingLabel(historyEntry({ commitSha: "c3", operationType: "import" })),
    "Last update - file import",
  );
  assert.equal(historyLastUpdateHeadingLabel({ plainText: "draft" }), "Last update");
});

test("optimistic history labels pending local saves instead of last updates", () => {
  const optimisticEntry = {
    ...historyEntry({ commitSha: "optimistic:op-1", authorName: "Saving..." }),
    optimistic: true,
  };

  assert.equal(historyLastUpdateLabel(optimisticEntry), "Pending local save");
  assert.equal(historyLastUpdateHeadingLabel(optimisticEntry), "Pending local save");
});

test("optimistic history entries cannot open committed-history actions", () => {
  const optimisticEntry = {
    ...historyEntry({ commitSha: "optimistic:op-1", operationType: "editor-replace" }),
    optimistic: true,
  };

  assert.equal(isOptimisticEditorHistoryEntry(optimisticEntry), true);
  assert.equal(historyEntryCanUndoReplace(optimisticEntry), false);
});

test("marker toggles that cancel out remain available in a collapsed group", () => {
  const model = buildEditorHistoryViewModel([
    historyEntry({ commitSha: "c3", pleaseCheck: false, operationType: "field-status", statusNote: 'Removed "Please check"' }),
    historyEntry({ commitSha: "c2", pleaseCheck: true, operationType: "field-status", statusNote: 'Marked "Please check"' }),
    historyEntry({ commitSha: "c1", operationType: "import" }),
  ], new Set());

  assert.equal(model.groups.length, 1);
  assert.deepEqual(model.groups[0].entries.map((entry) => entry.commitSha), ["c3", "c2", "c1"]);
  assert.deepEqual(model.visibleEntries.map((entry) => entry.commitSha), ["c3"]);
  const expanded = buildEditorHistoryViewModel(model.groups[0].entries, new Set([model.groups[0].key]));
  assert.deepEqual(expanded.visibleEntries.map((entry) => entry.commitSha), ["c3", "c2", "c1"]);
  assert.equal(expanded.olderVisibleEntryByCommitSha.get("c3").commitSha, "c2");
});

test("marker-only runs keep every revision in a same-user group", () => {
  const collapsedModel = buildEditorHistoryViewModel([
    historyEntry({ commitSha: "c4", reviewed: false, pleaseCheck: true, operationType: "field-status", statusNote: "Marked unreviewed" }),
    historyEntry({ commitSha: "c3", reviewed: true, pleaseCheck: true, operationType: "field-status", statusNote: 'Marked "Please check"' }),
    historyEntry({ commitSha: "c2", reviewed: true, pleaseCheck: false, operationType: "field-status", statusNote: "Marked reviewed" }),
    historyEntry({ commitSha: "c1", reviewed: false, pleaseCheck: false, operationType: "editor-update" }),
  ], new Set());

  assert.equal(collapsedModel.groups.length, 1);
  assert.equal(collapsedModel.groups[0].entries.length, 4);
  assert.equal(collapsedModel.groups[0].entries[0].commitSha, "c4");
  assert.equal(collapsedModel.groups[0].entries[1].statusNote, 'Marked "Please check"');
  assert.equal(collapsedModel.groups[0].entries[3].commitSha, "c1");
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

test("current-entry matching serializes labeled footnotes before comparing", () => {
  const entry = historyEntry({
    commitSha: "c1",
    plainText: "Hello",
    footnote: "[1] First note\n\n[2] Second note",
  });

  assert.equal(
    editorHistoryEntryMatchesSection(entry, {
      text: "Hello",
      footnote: "First note\n\nSecond note",
      footnotes: [
        { marker: 1, text: "First note" },
        { marker: 2, text: "Second note" },
      ],
      textStyle: "paragraph",
      reviewed: false,
      pleaseCheck: false,
    }),
    true,
  );
  assert.equal(
    editorHistoryEntryMatchesSection(entry, {
      text: "Hello",
      footnote: "First note\n\nEdited note",
      footnotes: [
        { marker: 1, text: "First note" },
        { marker: 2, text: "Edited note" },
      ],
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

test("formatting and image changes can group when text is unchanged", () => {
  const model = buildEditorHistoryViewModel([
    historyEntry({ commitSha: "c3", textStyle: "paragraph", image: { kind: "url", url: "https://example.com/figure.png" } }),
    historyEntry({ commitSha: "c2", textStyle: "heading1" }),
    historyEntry({ commitSha: "c1", operationType: "import", textStyle: "paragraph" }),
  ], new Set(["c1"]));

  assert.equal(model.groups.length, 1);
  assert.equal(model.groups[0].entries.length, 3);
  assert.equal(model.groups[0].entries[0].commitSha, "c3");
  assert.equal(model.groups[0].entries[1].commitSha, "c2");
  assert.equal(model.groups[0].entries[2].commitSha, "c1");
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

test("human and AI revisions chain by controlling user and credit the latest actor", () => {
  const model = buildEditorHistoryViewModel([
    historyEntry({ commitSha: "c4", authorName: "sirhans", operationType: "ai-translation", aiModel: "gpt-5.4" }),
    historyEntry({ commitSha: "c3", authorName: "sirhans", operationType: "ai-review", aiModel: "claude-sonnet-4.6" }),
    historyEntry({ commitSha: "c2", authorName: "sirhans", operationType: "editor-update" }),
    historyEntry({ commitSha: "c1", operationType: "import" }),
  ], new Set());

  assert.equal(model.groups.length, 2);
  assert.equal(model.groups[0].authorName, "GPT 5.4 - sirhans");
  assert.equal(model.groups[0].entries.length, 3);
  assert.equal(model.groups[1].authorName, "Import file");
  const humanLatest = buildEditorHistoryViewModel([
    historyEntry({ commitSha: "c5", authorName: "sirhans" }),
    ...model.groups.flatMap((group) => group.entries),
  ], new Set());
  assert.equal(humanLatest.groups[0].authorName, "sirhans");
  assert.equal(humanLatest.groups[0].entries.length, 4);
});

test("expanded history groups stay expanded when unchanged-text revisions extend the run", () => {
  const previousEntries = [
    historyEntry({ commitSha: "c3", plainText: "Newest" }),
    historyEntry({ commitSha: "c2", plainText: "Newest" }),
    historyEntry({ commitSha: "c1", authorName: "another-user", plainText: "Baseline" }),
  ];
  const previousModel = buildEditorHistoryViewModel(previousEntries, new Set());

  const nextEntries = [
    historyEntry({ commitSha: "c4", plainText: "Newest", aiModel: "gpt-5.4", reviewed: true }),
    ...previousEntries,
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
    "c2",
  );
});

for (const field of ["plainText", "footnote", "imageCaption", "attribution"]) {
  test(`a change in ${field} breaks the group even for the same human and AI`, () => {
    const entries = [
      historyEntry({ commitSha: "c4", [field]: "changed", aiModel: "gpt-5.4", reviewed: true }),
      historyEntry({ commitSha: "c3", [field]: "changed" }),
      historyEntry({ commitSha: "c2", [field]: "original", aiModel: "gpt-5.4", pleaseCheck: true }),
      historyEntry({ commitSha: "c1", [field]: "original" }),
    ];
    const model = buildEditorHistoryViewModel(entries, new Set());
    assert.deepEqual(model.groups.map((group) => group.entries.map((entry) => entry.commitSha)), [
      ["c4", "c3"], ["c2", "c1"],
    ]);
    assert.equal(model.olderVisibleEntryByCommitSha.get("c4").commitSha, "c2");
    assert.deepEqual(entries.map((entry) => entry.commitSha), ["c4", "c3", "c2", "c1"]);
  });
}

test("changing text and changing it back do not chain across the intervening edit", () => {
  const model = buildEditorHistoryViewModel([
    historyEntry({ commitSha: "c3", plainText: "original" }),
    historyEntry({ commitSha: "c2", plainText: "changed" }),
    historyEntry({ commitSha: "c1", plainText: "original" }),
  ], new Set());
  assert.equal(model.groups.length, 3);
});

test("a different controlling user breaks the chain even for the same AI model", () => {
  const model = buildEditorHistoryViewModel([
    historyEntry({ commitSha: "c3", authorName: "Hans", aiModel: "gpt-5.4" }),
    historyEntry({ commitSha: "c2", authorName: "Other", aiModel: "gpt-5.4" }),
    historyEntry({ commitSha: "c1", authorName: "Hans" }),
  ], new Set());
  assert.equal(model.groups.length, 3);
});

for (const field of ["authorLogin", "authorEmail"]) {
  test(`${field} identifies the user independently of display name`, () => {
    const model = buildEditorHistoryViewModel([
      historyEntry({ commitSha: "c3", authorName: "New name", [field]: "SAME", aiModel: "gpt-5.4" }),
      historyEntry({ commitSha: "c2", authorName: "Old name", [field]: "same" }),
      historyEntry({ commitSha: "c1", authorName: "Old name", [field]: "other" }),
    ], new Set());
    assert.equal(model.groups.length, 2);
    assert.equal(model.groups[0].entries.length, 2);
    assert.equal(model.groups[0].authorName, "GPT 5.4 - New name");
  });
}

test("unknown authors and pending saves do not group with committed entries", () => {
  const model = buildEditorHistoryViewModel([
    historyEntry({ commitSha: "optimistic:op-1" }),
    historyEntry({ commitSha: "c3" }),
    historyEntry({ commitSha: "c2", authorName: "" }),
    historyEntry({ commitSha: "c1", authorName: "" }),
  ], new Set());
  assert.equal(model.groups.length, 4);
});

test("a new text edit starts collapsed without closing the previously expanded group", () => {
  const previous = [
    historyEntry({ commitSha: "c2", reviewed: true }),
    historyEntry({ commitSha: "c1" }),
  ];
  const next = [historyEntry({ commitSha: "c3", plainText: "new text" }), ...previous];
  const keys = reconcileExpandedEditorHistoryGroupKeys(previous, next, new Set(["c1"]));
  const model = buildEditorHistoryViewModel(next, keys);
  assert.equal(keys.has(model.groups[0].key), false);
  assert.equal(keys.has(model.groups[1].key), true);
  assert.deepEqual(model.visibleEntries.map((entry) => entry.commitSha), ["c3", "c2", "c1"]);
});
