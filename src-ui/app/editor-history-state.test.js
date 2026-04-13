import test from "node:test";
import assert from "node:assert/strict";

import { buildEditorHistoryViewModel } from "./editor-history.js";
import {
  applyActiveEditorFieldHistoryLoaded,
  applyActiveEditorFieldHistoryLoadFailed,
  applyActiveEditorFieldHistoryLoading,
  applyEditorHistoryGroupExpandedToggle,
  applyEditorHistoryRestoreFailed,
  applyEditorHistoryRestoreRequested,
  applyEditorHistoryRestoreSucceeded,
  applyEditorReplaceUndoModalError,
  applyEditorReplaceUndoModalLoading,
  applyEditorRowHistoryRestored,
  buildEditorHistoryRequestKey,
  cancelEditorReplaceUndoModalState,
  currentActiveEditorHistoryEntryByCommitSha,
  currentEditorHistoryRequestMatches,
  historyEntryCanOpenReplaceUndo,
  openEditorReplaceUndoModalState,
} from "./editor-history-state.js";
import { createEditorChapterState, createEditorHistoryState } from "./state.js";

function historyEntry({
  commitSha,
  authorName = "gnosistms",
  operationType = "editor-update",
  plainText = "text",
  reviewed = false,
  pleaseCheck = false,
} = {}) {
  return {
    commitSha,
    authorName,
    committedAt: "2026-04-09T00:00:00Z",
    message: "Update row",
    operationType,
    plainText,
    reviewed,
    pleaseCheck,
  };
}

function chapter(overrides = {}) {
  return {
    ...createEditorChapterState(),
    chapterId: "chapter-1",
    activeRowId: "row-1",
    activeLanguageCode: "es",
    history: {
      ...createEditorHistoryState(),
      rowId: "row-1",
      languageCode: "es",
      entries: [],
      expandedGroupKeys: new Set(),
    },
    replaceUndoModal: {
      isOpen: false,
      status: "idle",
      error: "",
      commitSha: null,
    },
    ...overrides,
  };
}

function row(overrides = {}) {
  return {
    rowId: "row-1",
    fields: { es: "nuevo" },
    persistedFields: { es: "viejo" },
    fieldStates: { es: { reviewed: false, pleaseCheck: false } },
    persistedFieldStates: { es: { reviewed: false, pleaseCheck: false } },
    saveStatus: "dirty",
    saveError: "bad",
    ...overrides,
  };
}

test("buildEditorHistoryRequestKey returns a stable key only when all parts are present", () => {
  assert.equal(buildEditorHistoryRequestKey("chapter-1", "row-1", "es"), "chapter-1:row-1:es");
  assert.equal(buildEditorHistoryRequestKey("chapter-1", "", "es"), null);
});

test("applyActiveEditorFieldHistoryLoading scopes loading state to the active field", () => {
  const updatedChapter = applyActiveEditorFieldHistoryLoading(chapter({
    history: {
      ...createEditorHistoryState(),
      status: "ready",
      rowId: "row-1",
      languageCode: "es",
      requestKey: "old",
      expandedGroupKeys: new Set(["group-a"]),
      entries: [historyEntry({ commitSha: "c1" })],
    },
  }));

  assert.equal(updatedChapter.history.status, "loading");
  assert.equal(updatedChapter.history.requestKey, "chapter-1:row-1:es");
  assert.deepEqual([...updatedChapter.history.expandedGroupKeys], ["group-a"]);
});

test("applyActiveEditorFieldHistoryLoaded reconciles expanded same-author groups across new entries", () => {
  const previousEntries = [
    historyEntry({ commitSha: "c2", plainText: "newer" }),
    historyEntry({ commitSha: "c1", authorName: "other-user", plainText: "baseline" }),
  ];
  const previousGroupKey = buildEditorHistoryViewModel(previousEntries, new Set()).groups[0].key;
  const updatedChapter = applyActiveEditorFieldHistoryLoaded(
    chapter({
      history: {
        ...createEditorHistoryState(),
        status: "loading",
        rowId: "row-1",
        languageCode: "es",
        requestKey: "chapter-1:row-1:es",
        entries: previousEntries,
        expandedGroupKeys: new Set([previousGroupKey]),
      },
    }),
    "row-1",
    "es",
    "chapter-1:row-1:es",
    [
      historyEntry({ commitSha: "c3", plainText: "newest" }),
      ...previousEntries,
    ],
  );

  const nextGroupKey = buildEditorHistoryViewModel(updatedChapter.history.entries, new Set()).groups[0].key;
  assert.equal(updatedChapter.history.status, "ready");
  assert.equal(updatedChapter.history.expandedGroupKeys.has(nextGroupKey), true);
});

test("applyActiveEditorFieldHistoryLoadFailed preserves expansion state and stores the error", () => {
  const updatedChapter = applyActiveEditorFieldHistoryLoadFailed(
    chapter({
      history: {
        ...createEditorHistoryState(),
        expandedGroupKeys: new Set(["group-a"]),
      },
    }),
    "row-1",
    "es",
    "chapter-1:row-1:es",
    "load failed",
  );

  assert.equal(updatedChapter.history.status, "error");
  assert.equal(updatedChapter.history.error, "load failed");
  assert.deepEqual([...updatedChapter.history.expandedGroupKeys], ["group-a"]);
});

test("currentEditorHistoryRequestMatches checks chapter, selection, and request key together", () => {
  const chapterState = chapter({
    history: {
      ...createEditorHistoryState(),
      requestKey: "chapter-1:row-1:es",
    },
  });

  assert.equal(
    currentEditorHistoryRequestMatches(chapterState, "chapter-1", "row-1", "es", "chapter-1:row-1:es"),
    true,
  );
  assert.equal(
    currentEditorHistoryRequestMatches(chapterState, "chapter-1", "row-2", "es", "chapter-1:row-1:es"),
    false,
  );
});

test("applyEditorHistoryGroupExpandedToggle adds and removes expanded keys", () => {
  const expanded = applyEditorHistoryGroupExpandedToggle(chapter(), "group-a");
  const collapsed = applyEditorHistoryGroupExpandedToggle(expanded, "group-a");

  assert.equal(expanded.history.expandedGroupKeys.has("group-a"), true);
  assert.equal(collapsed.history.expandedGroupKeys.has("group-a"), false);
});

test("applyEditorHistoryRestoreRequested marks the active field as restoring", () => {
  const updatedChapter = applyEditorHistoryRestoreRequested(chapter(), "commit-1");

  assert.equal(updatedChapter.history.status, "restoring");
  assert.equal(updatedChapter.history.restoringCommitSha, "commit-1");
  assert.equal(updatedChapter.history.requestKey, "chapter-1:row-1:es");
});

test("applyEditorHistoryRestoreSucceeded clears the restoring state", () => {
  const updatedChapter = applyEditorHistoryRestoreSucceeded(chapter({
    history: {
      ...createEditorHistoryState(),
      status: "restoring",
      restoringCommitSha: "commit-1",
    },
  }));

  assert.equal(updatedChapter.history.status, "idle");
  assert.equal(updatedChapter.history.restoringCommitSha, null);
});

test("applyEditorHistoryRestoreFailed returns the history panel to ready state", () => {
  const updatedChapter = applyEditorHistoryRestoreFailed(chapter({
    history: {
      ...createEditorHistoryState(),
      status: "restoring",
      restoringCommitSha: "commit-1",
    },
  }));

  assert.equal(updatedChapter.history.status, "ready");
  assert.equal(updatedChapter.history.restoringCommitSha, null);
});

test("applyEditorRowHistoryRestored updates current and persisted field values together", () => {
  const updatedRow = applyEditorRowHistoryRestored(row(), "es", {
    plainText: "restored text",
    reviewed: true,
    pleaseCheck: true,
  });

  assert.equal(updatedRow.fields.es, "restored text");
  assert.equal(updatedRow.persistedFields.es, "restored text");
  assert.deepEqual(updatedRow.fieldStates.es, { reviewed: true, pleaseCheck: true });
  assert.deepEqual(updatedRow.persistedFieldStates.es, { reviewed: true, pleaseCheck: true });
  assert.equal(updatedRow.saveStatus, "idle");
  assert.equal(updatedRow.saveError, "");
});

test("replace undo modal helpers open, load, fail, and cancel without losing the commit sha", () => {
  const opened = openEditorReplaceUndoModalState(chapter(), "commit-1");
  const loading = applyEditorReplaceUndoModalLoading(opened);
  const failed = applyEditorReplaceUndoModalError(loading, "bad");
  const canceled = cancelEditorReplaceUndoModalState(failed);

  assert.equal(opened.replaceUndoModal.isOpen, true);
  assert.equal(loading.replaceUndoModal.status, "loading");
  assert.equal(failed.replaceUndoModal.status, "idle");
  assert.equal(failed.replaceUndoModal.error, "bad");
  assert.equal(failed.replaceUndoModal.commitSha, "commit-1");
  assert.equal(canceled.replaceUndoModal.isOpen, false);
  assert.equal(canceled.replaceUndoModal.commitSha, null);
});

test("historyEntryCanOpenReplaceUndo only allows editor-replace entries in the active selection", () => {
  const chapterState = chapter({
    history: {
      ...createEditorHistoryState(),
      rowId: "row-1",
      languageCode: "es",
      entries: [
        historyEntry({ commitSha: "replace-1", operationType: "editor-replace" }),
        historyEntry({ commitSha: "update-1", operationType: "editor-update" }),
      ],
    },
  });

  assert.equal(historyEntryCanOpenReplaceUndo(chapterState, "replace-1"), true);
  assert.equal(historyEntryCanOpenReplaceUndo(chapterState, "update-1"), false);
  assert.equal(currentActiveEditorHistoryEntryByCommitSha(chapterState, "replace-1")?.commitSha, "replace-1");
});
