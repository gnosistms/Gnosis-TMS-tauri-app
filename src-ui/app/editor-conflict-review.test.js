import test from "node:test";
import assert from "node:assert/strict";
import { initializeConflictReview, chooseConflictPassage, conflictReviewPendingCount } from "./editor-conflict-review.js";

test("each footnote is resolved independently and unchanged text is preserved", () => {
  let modal = initializeConflictReview({ localText: "unchanged", remoteText: "unchanged",
    localFootnote: "[1] local one\n\n[2] local two\n\n[3] unchanged",
    remoteFootnote: "[1] remote one\n\n[2] remote two\n\n[3] unchanged" });
  assert.equal(conflictReviewPendingCount(modal), 2);
  modal = chooseConflictPassage(modal, "footnote-1", "local");
  assert.equal(conflictReviewPendingCount(modal), 1);
  modal = chooseConflictPassage(modal, "footnote-2", "remote");
  assert.equal(modal.finalFootnote, "[1] local one\n\n[2] remote two\n\n[3] unchanged");
  assert.equal(modal.finalText, "unchanged");
  assert.equal(conflictReviewPendingCount(modal), 0);
});

test("missing base disables combining and manual editing is an explicit decision", () => {
  let modal = initializeConflictReview({ localText: "a", remoteText: "b" });
  modal = chooseConflictPassage(modal, "text", "combined");
  assert.equal(conflictReviewPendingCount(modal), 1);
  modal = chooseConflictPassage(modal, "text", "manual", "custom");
  assert.equal(modal.finalText, "custom");
  assert.equal(conflictReviewPendingCount(modal), 0);
  modal = chooseConflictPassage(modal, "text", "undo");
  assert.equal(conflictReviewPendingCount(modal), 1);
});

test("footnote deletion differs from keeping an empty note", () => {
  let modal = initializeConflictReview({ localFootnote: "[2] local", remoteFootnote: "" });
  modal = chooseConflictPassage(modal, "footnote-2", "remote");
  assert.equal(modal.finalFootnote, "");
  modal = chooseConflictPassage(modal, "footnote-2", "manual", "");
  assert.equal(modal.finalFootnote, "[2]");
});

test("compatible suggestions require acceptance and never splice two media URLs", () => {
  let modal = initializeConflictReview({ hasSharedBase: true, baseText: "one two three", localText: "ONE two three", remoteText: "one two THREE",
    baseImageUrl: "https://old.test/a", localImageUrl: "https://new.test/a", remoteImageUrl: "https://old.test/b" });
  assert.equal(modal.finalText, "ONE two THREE");
  assert.equal(conflictReviewPendingCount(modal), 2);
  assert.equal(modal.review.find((p) => p.kind === "imageUrl").combined, null);
  modal = chooseConflictPassage(modal, "text", "combined");
  assert.equal(conflictReviewPendingCount(modal), 1);
});
