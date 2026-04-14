import test from "node:test";
import assert from "node:assert/strict";

import { buildEditorShowRowInContextChapterState } from "./editor-show-context.js";
import { createEditorChapterState } from "./state.js";

test("buildEditorShowRowInContextChapterState clears filters and disables replace", () => {
  const chapterState = {
    ...createEditorChapterState(),
    filters: {
      searchQuery: "distintos",
      caseSensitive: true,
      rowFilterMode: "reviewed",
    },
    replace: {
      enabled: true,
      replaceQuery: "nuevos",
      selectedRowIds: new Set(["row-1", "row-2"]),
      status: "saving",
      error: "old error",
    },
  };

  const nextState = buildEditorShowRowInContextChapterState(chapterState);

  assert.equal(nextState.filters.searchQuery, "");
  assert.equal(nextState.filters.caseSensitive, true);
  assert.equal(nextState.filters.rowFilterMode, "show-all");
  assert.equal(nextState.replace.enabled, false);
  assert.equal(nextState.replace.replaceQuery, "nuevos");
  assert.deepEqual([...nextState.replace.selectedRowIds], []);
  assert.equal(nextState.replace.status, "idle");
  assert.equal(nextState.replace.error, "");
});
