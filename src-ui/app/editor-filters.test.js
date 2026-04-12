import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEditorFilterResult,
  editorChapterFiltersAreActive,
  findEditorSearchMatches,
} from "./editor-filters.js";

function language(code, name = code) {
  return { code, name };
}

function row(rowId, fields, lifecycleState = "active") {
  return {
    kind: "row",
    id: rowId,
    rowId,
    lifecycleState,
    sections: Object.entries(fields).map(([code, text]) => ({
      code,
      name: code,
      text,
    })),
  };
}

test("editor filters are inactive when the search query is empty", () => {
  assert.equal(editorChapterFiltersAreActive({ searchQuery: "" }), false);
  assert.equal(editorChapterFiltersAreActive({ searchQuery: "   " }), false);
  assert.equal(editorChapterFiltersAreActive({ searchQuery: "distintos" }), true);
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

test("search match ranges are case-insensitive and non-overlapping", () => {
  const matches = findEditorSearchMatches("Distintos distintos", "DISTINTOS", "es");

  assert.deepEqual(matches, [
    { start: 0, end: 9 },
    { start: 10, end: 19 },
  ]);
});
