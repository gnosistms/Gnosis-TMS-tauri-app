import test from "node:test";
import assert from "node:assert/strict";

import {
  applyEditorCommentSaveSucceeded,
  applyEditorCommentsLoading,
  currentEditorCommentsRequestMatches,
  nextEditorCommentsRequestKey,
} from "./editor-comments-state.js";

test("each comments fetch gets a distinct request key", () => {
  const first = nextEditorCommentsRequestKey("c1", "r1");
  const second = nextEditorCommentsRequestKey("c1", "r1");

  assert.notEqual(first, second);
  assert.equal(nextEditorCommentsRequestKey("", "r1"), null);
  assert.equal(nextEditorCommentsRequestKey("c1", ""), null);
});

test("a save invalidates a pre-save fetch so it cannot overwrite the saved comment", () => {
  const base = { chapterId: "c1", activeRowId: "r1", rows: [{ rowId: "r1" }], comments: {} };

  // A fetch is dispatched for the active row.
  const fetchKey = nextEditorCommentsRequestKey("c1", "r1");
  const loading = applyEditorCommentsLoading(base, "r1", fetchKey);
  assert.ok(
    currentEditorCommentsRequestMatches(loading, "c1", "r1", fetchKey),
    "the in-flight fetch matches while loading",
  );

  // The user saves a comment before that fetch resolves.
  const saved = applyEditorCommentSaveSucceeded(loading, "r1", {
    comments: [{ id: "new", body: "hi" }],
    commentsRevision: 1,
    commentCount: 1,
  });

  // The now-stale fetch response is rejected by the match guard, so it cannot
  // resurrect the pre-save entries.
  assert.equal(
    currentEditorCommentsRequestMatches(saved, "c1", "r1", fetchKey),
    false,
    "the stale fetch no longer matches the saved state",
  );
});
