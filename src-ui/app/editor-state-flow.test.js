import test from "node:test";
import assert from "node:assert/strict";

import {
  applyEditorUiState,
  markEditorRowsPersisted,
  normalizeEditorRows,
} from "./editor-state-flow.js";
import { createEditorChapterState, createEditorHistoryState, state } from "./state.js";

function snapshotSharedState() {
  return {
    editorChapter: state.editorChapter,
    projects: state.projects,
    deletedProjects: state.deletedProjects,
    teams: state.teams,
    selectedTeamId: state.selectedTeamId,
  };
}

function restoreSharedState(snapshot) {
  state.editorChapter = snapshot.editorChapter;
  state.projects = snapshot.projects;
  state.deletedProjects = snapshot.deletedProjects;
  state.teams = snapshot.teams;
  state.selectedTeamId = snapshot.selectedTeamId;
}

test("applyEditorUiState preserves same-chapter editor UI state when the active field still exists", () => {
  const previousHistory = {
    ...createEditorHistoryState(),
    status: "ready",
    rowId: "row-1",
    languageCode: "en",
    entries: [{ commitSha: "abc123" }],
    expandedGroupKeys: new Set(["group-a"]),
  };
  const previousEditorChapter = {
    ...createEditorChapterState(),
    chapterId: "chapter-1",
    fontSizePx: 24,
    collapsedLanguageCodes: new Set(["fr"]),
    dirtyRowIds: new Set(["row-1", "row-missing"]),
    filters: { searchQuery: "needle", caseSensitive: true, rowFilterMode: "reviewed" },
    replace: {
      enabled: true,
      replaceQuery: "swap",
      selectedRowIds: new Set(["row-1"]),
      status: "saving",
      error: "ignored",
    },
    expandedDeletedRowGroupIds: new Set(["deleted-group-1"]),
    glossary: { status: "ready", glossaryId: "g-1" },
    insertRowModal: { isOpen: true, rowId: "row-1", status: "idle", error: "" },
    rowPermanentDeletionModal: { isOpen: true, rowId: "row-1", status: "idle", error: "" },
    replaceUndoModal: { isOpen: true, commitSha: "abc123", status: "idle", error: "" },
    activeRowId: "row-1",
    activeLanguageCode: "en",
    sidebarTab: "translate",
    reviewExpandedSectionKeys: new Set(),
    history: previousHistory,
  };

  const nextEditorChapter = {
    chapterId: "chapter-1",
    languages: [{ code: "en" }],
    rows: [{ rowId: "row-1" }],
  };

  const result = applyEditorUiState(nextEditorChapter, previousEditorChapter);

  assert.equal(result.fontSizePx, 24);
  assert.deepEqual([...result.collapsedLanguageCodes], ["fr"]);
  assert.deepEqual([...result.dirtyRowIds], ["row-1"]);
  assert.equal(result.activeRowId, "row-1");
  assert.equal(result.activeLanguageCode, "en");
  assert.equal(result.sidebarTab, "translate");
  assert.deepEqual([...result.reviewExpandedSectionKeys], []);
  assert.equal(result.history.entries.length, 1);
  assert.equal(result.history.entries[0].commitSha, "abc123");
  assert.deepEqual([...result.history.expandedGroupKeys], ["group-a"]);
  assert.equal(result.insertRowModal.isOpen, true);
  assert.equal(result.rowPermanentDeletionModal.isOpen, true);
  assert.equal(result.replaceUndoModal.isOpen, true);
  assert.equal(result.filters.searchQuery, "needle");
  assert.equal(result.filters.caseSensitive, true);
  assert.equal(result.filters.rowFilterMode, "reviewed");
  assert.equal(result.replace.enabled, true);
  assert.equal(result.replace.replaceQuery, "swap");
  assert.deepEqual([...result.replace.selectedRowIds], ["row-1"]);
});

test("applyEditorUiState clears active field state when the row or language no longer exists", () => {
  const previousEditorChapter = {
    ...createEditorChapterState(),
    chapterId: "chapter-1",
    insertRowModal: { isOpen: true, rowId: "row-1", status: "idle", error: "" },
    rowPermanentDeletionModal: { isOpen: true, rowId: "row-1", status: "idle", error: "" },
    activeRowId: "row-1",
    activeLanguageCode: "en",
    history: {
      ...createEditorHistoryState(),
      rowId: "row-1",
      languageCode: "en",
      status: "ready",
      entries: [{ commitSha: "abc123" }],
    },
  };

  const nextEditorChapter = {
    chapterId: "chapter-1",
    languages: [{ code: "fr" }],
    rows: [{ rowId: "row-2" }],
  };

  const result = applyEditorUiState(nextEditorChapter, previousEditorChapter);

  assert.equal(result.activeRowId, null);
  assert.equal(result.activeLanguageCode, null);
  assert.equal(result.history.status, "idle");
  assert.deepEqual(result.history.entries, []);
  assert.equal(result.insertRowModal.isOpen, false);
  assert.equal(result.rowPermanentDeletionModal.isOpen, false);
});

test("normalizeEditorRows clones row data and initializes persistence metadata", () => {
  const sourceRows = [{
    rowId: "row-1",
    orderKey: "001",
    lifecycleState: "unexpected",
    textStyle: "heading2",
    fields: { en: "hello" },
    fieldStates: { en: { reviewed: true, pleaseCheck: false } },
  }];

  const result = normalizeEditorRows(sourceRows);
  sourceRows[0].fields.en = "changed";
  sourceRows[0].fieldStates.en.reviewed = false;

  assert.equal(result.length, 1);
  assert.equal(result[0].fields.en, "hello");
  assert.equal(result[0].persistedFields.en, "hello");
  assert.equal(result[0].fieldStates.en.reviewed, true);
  assert.equal(result[0].persistedFieldStates.en.reviewed, true);
  assert.equal(result[0].lifecycleState, "active");
  assert.equal(result[0].textStyle, "heading2");
  assert.equal(result[0].saveStatus, "idle");
  assert.equal(result[0].markerSaveState.status, "idle");
  assert.equal(result[0].textStyleSaveState.status, "idle");
});

test("markEditorRowsPersisted updates persisted fields and clears reconciled dirty row ids", () => {
  const snapshot = snapshotSharedState();

  try {
    state.projects = [];
    state.deletedProjects = [];
    state.teams = [];
    state.selectedTeamId = null;
    state.editorChapter = {
      ...createEditorChapterState(),
      chapterId: "chapter-1",
      sourceWordCounts: {},
      dirtyRowIds: new Set(["row-1"]),
      rows: normalizeEditorRows([{
        rowId: "row-1",
        fields: { en: "old" },
        fieldStates: {},
      }]),
    };
    state.editorChapter.rows[0] = {
      ...state.editorChapter.rows[0],
      fields: { en: "new" },
      saveStatus: "dirty",
    };

    markEditorRowsPersisted([{ rowId: "row-1", fields: { en: "new" } }], { en: 7 });

    assert.equal(state.editorChapter.rows[0].fields.en, "new");
    assert.equal(state.editorChapter.rows[0].persistedFields.en, "new");
    assert.equal(state.editorChapter.rows[0].saveStatus, "idle");
    assert.deepEqual(state.editorChapter.sourceWordCounts, { en: 7 });
    assert.deepEqual([...state.editorChapter.dirtyRowIds], []);
  } finally {
    restoreSharedState(snapshot);
  }
});
