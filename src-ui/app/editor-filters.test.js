import test from "node:test";
import assert from "node:assert/strict";

import {
  EDITOR_ROW_FILTER_MODE_HAS_COMMENTS,
  EDITOR_ROW_FILTER_MODE_HAS_CONFLICT,
  EDITOR_ROW_FILTER_MODE_HAS_UNREAD_COMMENTS,
  EDITOR_ROW_FILTER_MODE_NOT_REVIEWED,
  EDITOR_ROW_FILTER_MODE_PLEASE_CHECK,
  EDITOR_ROW_FILTER_MODE_REVIEWED,
  EDITOR_ROW_FILTER_MODE_TARGET_EMPTY,
  buildEditorFilterResult,
  editorChapterFiltersAreActive,
  findEditorSearchMatches,
} from "./editor-filters.js";

function language(code, name = code) {
  return { code, name };
}

function row(rowId, fields, lifecycleState = "active", options = {}) {
  return {
    kind: "row",
    id: rowId,
    rowId,
    lifecycleState,
    hasConflict: options.hasConflict === true,
    freshness: typeof options.freshness === "string" ? options.freshness : "fresh",
    saveStatus: typeof options.saveStatus === "string" ? options.saveStatus : "idle",
    commentCount: Number.isInteger(options.commentCount) ? options.commentCount : 0,
    commentsRevision: Number.isInteger(options.commentsRevision) ? options.commentsRevision : 0,
    hasTextConflict: options.hasTextConflict === true,
    textConflictState: typeof options.textConflictState === "string" ? options.textConflictState : "",
    sections: Object.entries(fields).map(([code, text]) => ({
      code,
      name: code,
      text,
      footnote: options.footnotes?.[code] ?? "",
      hasVisibleFootnote:
        options.visibleFootnotes?.[code] === true
        || String(options.footnotes?.[code] ?? "").trim().length > 0,
      reviewed: options.reviewedByLanguage?.[code] === true,
      pleaseCheck: options.pleaseCheckByLanguage?.[code] === true,
    })),
  };
}

test("editor filters are inactive when the search query is empty and the dropdown is show all", () => {
  assert.equal(editorChapterFiltersAreActive({ searchQuery: "" }), false);
  assert.equal(editorChapterFiltersAreActive({ searchQuery: "   " }), false);
  assert.equal(editorChapterFiltersAreActive({ searchQuery: "distintos" }), true);
  assert.equal(editorChapterFiltersAreActive({ searchQuery: "", rowFilterMode: "show-all" }), false);
  assert.equal(editorChapterFiltersAreActive({ searchQuery: "", rowFilterMode: "reviewed" }), true);
});

test("search can be case-sensitive", () => {
  const insensitiveMatches = findEditorSearchMatches("Distintos distintos", "DISTINTOS", "es");
  const sensitiveMatches = findEditorSearchMatches("Distintos distintos", "DISTINTOS", "es", {
    caseSensitive: true,
  });
  const exactSensitiveMatches = findEditorSearchMatches("Distintos distintos", "Distintos", "es", {
    caseSensitive: true,
  });

  assert.deepEqual(insensitiveMatches, [
    { start: 0, end: 9 },
    { start: 10, end: 19 },
  ]);
  assert.deepEqual(sensitiveMatches, []);
  assert.deepEqual(exactSensitiveMatches, [{ start: 0, end: 9 }]);
});

test("search matches only visible languages", () => {
  const result = buildEditorFilterResult({
    rows: [
      row("row-1", { es: "sin termino", vi: "distintos aqui" }),
      row("row-2", { es: "distintos aqui", vi: "sin termino" }),
    ],
    languages: [language("es"), language("vi")],
    collapsedLanguageCodes: new Set(["vi"]),
    filters: { searchQuery: "distintos" },
  });

  assert.deepEqual(result.filteredRows.map((item) => item.id), ["row-2"]);
  assert.equal(result.matchingRowCount, 1);
});

test("search preserves row ordering and excludes deleted rows by default", () => {
  const result = buildEditorFilterResult({
    rows: [
      row("row-a", { es: "distintos primero" }),
      row("row-b", { es: "sin termino" }),
      row("row-c", { es: "distintos tercero" }, "deleted"),
      row("row-d", { es: "distintos cuarto" }),
    ],
    languages: [language("es")],
    collapsedLanguageCodes: new Set(),
    filters: { searchQuery: "distintos" },
  });

  assert.deepEqual(result.filteredRows.map((item) => item.id), ["row-a", "row-d"]);
  assert.equal(result.searchResults.length, 2);
});

test("search includes visible footnotes and keeps their keys distinct from main text", () => {
  const result = buildEditorFilterResult({
    rows: [
      row(
        "row-1",
        { es: "distintos cuerpo" },
        "active",
        { footnotes: { es: "distintos nota" } },
      ),
    ],
    languages: [language("es")],
    collapsedLanguageCodes: new Set(),
    filters: { searchQuery: "distintos" },
  });

  assert.deepEqual(result.filteredRows.map((item) => item.id), ["row-1"]);
  assert.equal(result.searchResults.length, 2);
  assert.deepEqual(
    result.searchResults.map((match) => [match.contentKind, match.key]),
    [
      ["field", "row-1:es:field:0:9"],
      ["footnote", "row-1:es:footnote:0:9"],
    ],
  );
  assert.deepEqual(
    [...(result.searchMatchesByRowId.get("row-1")?.keys() ?? [])],
    ["es:field", "es:footnote"],
  );
});

test("no active filters returns the unfiltered rows", () => {
  const rows = [
    row("row-1", { es: "uno" }),
    row("row-2", { es: "dos" }, "deleted"),
  ];
  const result = buildEditorFilterResult({
    rows,
    languages: [language("es")],
    collapsedLanguageCodes: new Set(),
    filters: { searchQuery: "" },
  });

  assert.equal(result.hasActiveFilters, false);
  assert.deepEqual(result.filteredRows, rows);
});

test("reviewed and not reviewed filters use the selected target language", () => {
  const rows = [
    row("row-1", { es: "uno" }, "active", { reviewedByLanguage: { es: true } }),
    row("row-2", { es: "dos" }),
  ];

  const reviewed = buildEditorFilterResult({
    rows,
    languages: [language("es")],
    collapsedLanguageCodes: new Set(),
    targetLanguageCode: "es",
    filters: { rowFilterMode: EDITOR_ROW_FILTER_MODE_REVIEWED },
  });
  const notReviewed = buildEditorFilterResult({
    rows,
    languages: [language("es")],
    collapsedLanguageCodes: new Set(),
    targetLanguageCode: "es",
    filters: { rowFilterMode: EDITOR_ROW_FILTER_MODE_NOT_REVIEWED },
  });

  assert.deepEqual(reviewed.filteredRows.map((item) => item.id), ["row-1"]);
  assert.deepEqual(notReviewed.filteredRows.map((item) => item.id), ["row-2"]);
});

test("please check and target empty filters use the selected target language", () => {
  const rows = [
    row("row-1", { es: "texto" }, "active", { pleaseCheckByLanguage: { es: true } }),
    row("row-2", { es: "   " }),
    row("row-3", { es: "lleno" }),
  ];

  const pleaseCheck = buildEditorFilterResult({
    rows,
    languages: [language("es")],
    collapsedLanguageCodes: new Set(),
    targetLanguageCode: "es",
    filters: { rowFilterMode: EDITOR_ROW_FILTER_MODE_PLEASE_CHECK },
  });
  const targetEmpty = buildEditorFilterResult({
    rows,
    languages: [language("es")],
    collapsedLanguageCodes: new Set(),
    targetLanguageCode: "es",
    filters: { rowFilterMode: EDITOR_ROW_FILTER_MODE_TARGET_EMPTY },
  });

  assert.deepEqual(pleaseCheck.filteredRows.map((item) => item.id), ["row-1"]);
  assert.deepEqual(targetEmpty.filteredRows.map((item) => item.id), ["row-2"]);
});

test("comment filters use row comment counts and per-user unread revisions", () => {
  const rows = [
    row("row-1", { es: "uno" }, "active", { commentCount: 2, commentsRevision: 4 }),
    row("row-2", { es: "dos" }, "active", { commentCount: 1, commentsRevision: 2 }),
    row("row-3", { es: "tres" }),
  ];

  const hasComments = buildEditorFilterResult({
    rows,
    languages: [language("es")],
    collapsedLanguageCodes: new Set(),
    targetLanguageCode: "es",
    filters: { rowFilterMode: EDITOR_ROW_FILTER_MODE_HAS_COMMENTS },
  });
  const hasUnreadComments = buildEditorFilterResult({
    rows,
    languages: [language("es")],
    collapsedLanguageCodes: new Set(),
    targetLanguageCode: "es",
    commentSeenRevisions: { "row-1": 3, "row-2": 2 },
    filters: { rowFilterMode: EDITOR_ROW_FILTER_MODE_HAS_UNREAD_COMMENTS },
  });

  assert.deepEqual(hasComments.filteredRows.map((item) => item.id), ["row-1", "row-2"]);
  assert.deepEqual(hasUnreadComments.filteredRows.map((item) => item.id), ["row-1"]);
});

test("conflict filter only matches unresolved text conflicts", () => {
  const result = buildEditorFilterResult({
    rows: [
      row("row-1", { es: "uno" }, "active", { hasTextConflict: true }),
      row("row-2", { es: "dos" }, "active", { textConflictState: "unresolved" }),
      row("row-3", { es: "tres" }, "active", { freshness: "conflict" }),
      row("row-4", { es: "cuatro" }, "active", { textConflictState: "resolved" }),
    ],
    languages: [language("es")],
    collapsedLanguageCodes: new Set(),
    targetLanguageCode: "es",
    filters: { rowFilterMode: EDITOR_ROW_FILTER_MODE_HAS_CONFLICT },
  });

  assert.deepEqual(result.filteredRows.map((item) => item.id), ["row-1", "row-2", "row-3"]);
});

test("unresolved editor conflicts force the filter to has conflict", () => {
  const result = buildEditorFilterResult({
    rows: [
      row("row-1", { es: "uno" }, "active", { freshness: "conflict" }),
      row("row-2", { es: "dos" }),
    ],
    languages: [language("es")],
    collapsedLanguageCodes: new Set(),
    targetLanguageCode: "es",
    filters: { rowFilterMode: "show-all" },
  });

  assert.equal(result.isConflictLocked, true);
  assert.equal(result.conflictRowCount, 1);
  assert.equal(result.filters.rowFilterMode, EDITOR_ROW_FILTER_MODE_HAS_CONFLICT);
  assert.deepEqual(result.filteredRows.map((item) => item.id), ["row-1"]);
});

test("search and dropdown filters compose", () => {
  const result = buildEditorFilterResult({
    rows: [
      row("row-1", { es: "distintos" }, "active", { reviewedByLanguage: { es: true } }),
      row("row-2", { es: "distintos" }),
      row("row-3", { es: "otro" }, "active", { reviewedByLanguage: { es: true } }),
    ],
    languages: [language("es")],
    collapsedLanguageCodes: new Set(),
    targetLanguageCode: "es",
    filters: {
      searchQuery: "distintos",
      rowFilterMode: EDITOR_ROW_FILTER_MODE_REVIEWED,
    },
  });

  assert.deepEqual(result.filteredRows.map((item) => item.id), ["row-1"]);
  assert.equal(result.matchingRowCount, 1);
});

test("search match ranges are case-insensitive and non-overlapping", () => {
  const matches = findEditorSearchMatches("Distintos distintos", "DISTINTOS", "es");

  assert.deepEqual(matches, [
    { start: 0, end: 9 },
    { start: 10, end: 19 },
  ]);
});
