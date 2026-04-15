import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEditorCommentsButtonState,
  editorCommentDraftCanSave,
  editorRowHasUnreadComments,
  normalizeEditorCommentSeenRevisions,
  normalizeEditorSidebarTab,
  resolveEditorSidebarTabForField,
} from "./editor-comments.js";
import {
  applyEditorCommentSaveSucceeded,
  applyEditorCommentsLoaded,
  applyEditorRowCommentSeen,
  pruneEditorCommentSeenRevisionsForRows,
} from "./editor-comments-state.js";
import { createEditorChapterState } from "./state.js";

function createChapterState(overrides = {}) {
  return {
    ...createEditorChapterState(),
    chapterId: "chapter-1",
    activeRowId: "row-1",
    activeLanguageCode: "vi",
    rows: [
      {
        rowId: "row-1",
        commentCount: 2,
        commentsRevision: 4,
      },
      {
        rowId: "row-2",
        commentCount: 0,
        commentsRevision: 0,
      },
    ],
    ...overrides,
  };
}

test("editorRowHasUnreadComments compares revision against the seen revision", () => {
  const row = {
    rowId: "row-1",
    commentCount: 2,
    commentsRevision: 4,
  };

  assert.equal(editorRowHasUnreadComments(row, { "row-1": 3 }), true);
  assert.equal(editorRowHasUnreadComments(row, { "row-1": 4 }), false);
  assert.equal(editorRowHasUnreadComments({ ...row, commentCount: 0 }, { "row-1": 0 }), false);
});

test("buildEditorCommentsButtonState only shows comments on the target language", () => {
  const row = {
    rowId: "row-1",
    commentCount: 1,
    commentsRevision: 2,
  };

  assert.deepEqual(
    buildEditorCommentsButtonState({
      row,
      languageCode: "es",
      targetLanguageCode: "vi",
      seenRevisions: {},
    }),
    {
      showCommentsButton: false,
      hasComments: true,
      hasUnreadComments: true,
    },
  );

  assert.deepEqual(
    buildEditorCommentsButtonState({
      row,
      languageCode: "vi",
      targetLanguageCode: "vi",
      seenRevisions: { "row-1": 2 },
    }),
    {
      showCommentsButton: true,
      hasComments: true,
      hasUnreadComments: false,
    },
  );
});

test("applyEditorCommentsLoaded and save success update row summaries and keep comments newest first", () => {
  const chapterState = createChapterState({
    comments: {
      rowId: "row-1",
      draft: "keep this draft",
      entries: [],
    },
  });

  const loaded = applyEditorCommentsLoaded(chapterState, "row-1", "chapter-1:row-1", {
    commentCount: 2,
    commentsRevision: 4,
    comments: [
      { commentId: "comment-1", createdAt: "2026-04-13T09:12:33Z", body: "older" },
      { commentId: "comment-2", createdAt: "2026-04-13T09:12:35Z", body: "newer" },
    ],
  });
  assert.equal(loaded.comments.draft, "keep this draft");
  assert.equal(loaded.rows[0].commentCount, 2);
  assert.equal(loaded.rows[0].commentsRevision, 4);
  assert.equal(loaded.comments.entries[0].commentId, "comment-2");

  const saved = applyEditorCommentSaveSucceeded(loaded, "row-1", {
    commentCount: 3,
    commentsRevision: 5,
    comments: [
      { commentId: "comment-3", createdAt: "2026-04-13T09:12:37Z", body: "latest" },
      { commentId: "comment-2", createdAt: "2026-04-13T09:12:35Z", body: "newer" },
    ],
  });
  assert.equal(saved.comments.draft, "");
  assert.equal(saved.rows[0].commentCount, 3);
  assert.equal(saved.rows[0].commentsRevision, 5);
  assert.equal(saved.comments.entries[0].commentId, "comment-3");
});

test("applyEditorRowCommentSeen and pruneEditorCommentSeenRevisionsForRows keep seen revisions coherent", () => {
  const chapterState = createChapterState({
    commentSeenRevisions: normalizeEditorCommentSeenRevisions({
      "row-1": 2,
      "row-missing": 9,
    }),
  });

  const seen = applyEditorRowCommentSeen(chapterState, "row-1", 4);
  assert.deepEqual(seen.commentSeenRevisions, { "row-1": 4, "row-missing": 9 });

  const pruned = pruneEditorCommentSeenRevisionsForRows(seen);
  assert.deepEqual(pruned.commentSeenRevisions, { "row-1": 4 });
});

test("editorCommentDraftCanSave requires non-empty trimmed text and no write in progress", () => {
  assert.equal(editorCommentDraftCanSave("   ", "idle"), false);
  assert.equal(editorCommentDraftCanSave("Needs review", "saving"), false);
  assert.equal(editorCommentDraftCanSave("Needs review", "deleting"), false);
  assert.equal(editorCommentDraftCanSave("Needs review", "ready"), true);
});

test("normalizeEditorSidebarTab keeps known tabs and falls back unknown tabs to review", () => {
  assert.equal(normalizeEditorSidebarTab("translate"), "translate");
  assert.equal(normalizeEditorSidebarTab("history"), "history");
  assert.equal(normalizeEditorSidebarTab("review"), "review");
  assert.equal(normalizeEditorSidebarTab("duplicates"), "review");
  assert.equal(normalizeEditorSidebarTab("something-else"), "review");
});

test("resolveEditorSidebarTabForField sends empty fields to translate", () => {
  assert.equal(
    resolveEditorSidebarTabForField("review", {
      fields: {
        vi: "   ",
      },
    }, "vi"),
    "translate",
  );
  assert.equal(
    resolveEditorSidebarTabForField("review", {
      fields: {
        vi: "Xin chao",
      },
    }, "vi"),
    "review",
  );
});
