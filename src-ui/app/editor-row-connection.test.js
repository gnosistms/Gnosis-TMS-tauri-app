import test from "node:test";
import assert from "node:assert/strict";
import { editorRowViewportDirection, reconcileEditorRowConnection } from "./editor-row-connection.js";
import { applyEditorRegressionFixture } from "./editor-regression-fixture.js";
import { buildEditorScreenViewModel } from "./editor-screen-model.js";
import { renderTranslationContentRow } from "./editor-row-render.js";
import { state } from "./state.js";
import { currentEditorHistoryRequestMatches } from "./editor-history-state.js";
import { currentEditorCommentsRequestMatches } from "./editor-comments-state.js";

test("row visibility uses intersection, including exact edges and oversized rows", () => {
  const viewport = { start: 100, end: 300 };
  for (const [start, end, direction] of [
    [0, 100, "above"], [300, 500, "below"], [0, 101, "visible"],
    [299, 500, "visible"], [0, 500, "visible"], [130, 160, "visible"],
  ]) assert.equal(editorRowViewportDirection({ start, end }, viewport), direction);
  assert.equal(editorRowViewportDirection(null, viewport), null);
  assert.equal(editorRowViewportDirection({ start: 0, end: 0 }, viewport), null);
  assert.equal(editorRowViewportDirection({ start: 0, end: 5 }, { start: 0, end: 0 }), null);
});

test("filtered membership clears the connection without losing edits, tab, or row-keyed drafts", () => {
  const previous = { ...state };
  try {
    applyEditorRegressionFixture(state, { rowCount: 200, chapterStatus: "ready" });
    const chapter = state.editorChapter;
    const rowId = chapter.rows[150].rowId;
    const draft = { threadsByKey: { saved: { draft: "assistant draft" } } };
    state.editorChapter = { ...chapter, activeRowId: rowId, activeLanguageCode: "vi",
      sidebarTab: "comments", assistant: draft,
      comments: { rowId, draft: "unfinished comment", requestKey: "old" },
      history: { rowId, languageCode: "vi", requestKey: "old" },
    };
    assert.equal(reconcileEditorRowConnection(state), false); // no DOM needed
    const model = buildEditorScreenViewModel(state);
    const row = model.contentRows.find((item) => item.id === rowId);
    assert.equal(row.isConnected, true);
    assert.match(renderTranslationContentRow(row), /translation-row-shell is-connected/);
    assert.equal(model.contentRows.filter((item) => item.isConnected).length, 1);
    state.editorChapter = { ...state.editorChapter, filters: { searchQuery: "no possible match 123456789" } };
    assert.equal(reconcileEditorRowConnection(state), true);
    assert.equal(state.editorChapter.activeRowId, null);
    assert.equal(state.editorChapter.activeLanguageCode, null);
    assert.equal(state.editorChapter.sidebarTab, "comments");
    assert.equal(state.editorChapter.rows, chapter.rows);
    assert.equal(state.editorChapter.assistant, draft);
    assert.equal(state.editorChapter.comments.draft, "unfinished comment");
    assert.equal(state.editorChapter.comments.requestKey, null);
    assert.equal(currentEditorHistoryRequestMatches(state.editorChapter, chapter.chapterId, rowId, "vi", "old"), false);
    assert.equal(currentEditorCommentsRequestMatches(state.editorChapter, chapter.chapterId, rowId, "old"), false);
    state.editorChapter.filters = {};
    assert.equal(reconcileEditorRowConnection(state), false);
    assert.equal(state.editorChapter.activeRowId, null);
  } finally { Object.assign(state, previous); }
});

test("temporarily unavailable chapter data does not disconnect selection", () => {
  const appState = { screen: "translate", editorChapter: { activeRowId: "row", status: "loading", rows: [] } };
  assert.equal(reconcileEditorRowConnection(appState), false);
  assert.equal(appState.editorChapter.activeRowId, "row");
});

test("filters that retain the row preserve selection; case and marker exclusions disconnect", () => {
  const previous = { ...state };
  try {
    applyEditorRegressionFixture(state, { rowCount: 6, chapterStatus: "ready",
      fieldsByRowId: { "fixture-row-0001": { vi: "DistinctToken" } },
    });
    const chapter = state.editorChapter;
    state.editorChapter = { ...chapter, filters: { searchQuery: "distincttoken" } };
    assert.equal(reconcileEditorRowConnection(state), false);
    state.editorChapter = { ...state.editorChapter, filters: { searchQuery: "distincttoken", caseSensitive: true } };
    assert.equal(reconcileEditorRowConnection(state), true);
    state.editorChapter = { ...chapter, filters: { rowFilterMode: "has-image" } };
    assert.equal(reconcileEditorRowConnection(state), true);
  } finally { Object.assign(state, previous); }
});

test("expanded deleted rows connect, collapsed and permanently removed rows disconnect", () => {
  const previous = { ...state };
  try {
    applyEditorRegressionFixture(state, { rowCount: 6, chapterStatus: "ready" });
    const id = state.editorChapter.activeRowId;
    state.editorChapter.rows = state.editorChapter.rows.map((row) => row.rowId === id
      ? { ...row, lifecycleState: "deleted" } : row);
    state.editorChapter.expandedDeletedRowGroupIds = new Set([id]);
    assert.equal(reconcileEditorRowConnection(state), false);
    assert.equal(buildEditorScreenViewModel(state).contentRows.find((row) => row.id === id).isConnected, true);
    const connected = state.editorChapter;
    state.editorChapter = { ...connected, expandedDeletedRowGroupIds: new Set() };
    assert.equal(reconcileEditorRowConnection(state), true);
    state.editorChapter = { ...connected, rows: connected.rows.filter((row) => row.rowId !== id) };
    assert.equal(reconcileEditorRowConnection(state), true);
    state.editorChapter = { ...connected, filters: { rowFilterMode: "deleted" }, expandedDeletedRowGroupIds: new Set() };
    assert.equal(reconcileEditorRowConnection(state), false);
  } finally { Object.assign(state, previous); }
});
