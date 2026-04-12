import test from "node:test";
import assert from "node:assert/strict";

import {
  applyEditorSearchReplace,
  buildEditorBatchReplaceUpdates,
} from "./editor-replace.js";

test("applyEditorSearchReplace replaces all case-insensitive matches by range", () => {
  assert.equal(
    applyEditorSearchReplace("Distintos y distintos", "distintos", "iguales", "es"),
    "iguales y iguales",
  );
});

test("applyEditorSearchReplace can replace case-sensitive matches only", () => {
  assert.equal(
    applyEditorSearchReplace("Distintos y distintos", "distintos", "iguales", "es", {
      caseSensitive: true,
    }),
    "Distintos y iguales",
  );
});

test("buildEditorBatchReplaceUpdates only updates selected rows in visible languages", () => {
  const result = buildEditorBatchReplaceUpdates({
    rows: [
      {
        rowId: "row-1",
        lifecycleState: "active",
        fields: {
          es: "distintos caminos",
          en: "different paths",
        },
      },
      {
        rowId: "row-2",
        lifecycleState: "active",
        fields: {
          es: "otros distintos",
          en: "other different",
        },
      },
    ],
    selectedRowIds: new Set(["row-2"]),
    visibleLanguageCodes: new Set(["es"]),
    searchQuery: "distintos",
    replaceText: "iguales",
  });

  assert.deepEqual(result.matchingSelectedRowIds, ["row-2"]);
  assert.deepEqual(result.updatedRowIds, ["row-2"]);
  assert.equal(result.updatedRows[0]?.fields?.es, "otros iguales");
  assert.equal(result.updatedRows[0]?.fields?.en, "other different");
});

test("buildEditorBatchReplaceUpdates respects case-sensitive matching", () => {
  const result = buildEditorBatchReplaceUpdates({
    rows: [
      {
        rowId: "row-1",
        lifecycleState: "active",
        fields: {
          es: "Distintos distintos",
        },
      },
    ],
    selectedRowIds: new Set(["row-1"]),
    visibleLanguageCodes: new Set(["es"]),
    searchQuery: "distintos",
    replaceText: "iguales",
    caseSensitive: true,
  });

  assert.deepEqual(result.matchingSelectedRowIds, ["row-1"]);
  assert.deepEqual(result.updatedRowIds, ["row-1"]);
  assert.equal(result.updatedRows[0]?.fields?.es, "Distintos iguales");
});
