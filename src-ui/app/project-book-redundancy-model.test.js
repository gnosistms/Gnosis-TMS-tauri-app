import test from "node:test";
import assert from "node:assert/strict";
import { bookRedundancyExclusions, imageReviewChoices, reviewChoiceIncluded } from "./project-book-redundancy-model.js";
const note = (id, itemId, marker = 1) => ({ id, itemId, rowId: `row-${id}`, kind: "footnote", marker, signature: `sig-${id}` });
const image = (id, itemId) => ({ ...note(id, itemId, 0), kind: "image" });
const setup = () => ({ book: { redundancy: { result: {
  footnotes: [{ id: "notes", occurrences: [note("first", "a"), note("later", "b")] }],
  images: [{ id: "picture", occurrences: [image("img-a", "a"), image("img-a-repeat", "a"), image("img-b", "b")] }],
}, choices: {} } } });
test("defaults keep first note and first image in the first chapter", () => {
  const modal = setup();
  assert.deepEqual(bookRedundancyExclusions(modal, "a").map((e) => e.rowId), ["row-img-a-repeat"]);
  assert.deepEqual(bookRedundancyExclusions(modal, "b").map((e) => e.rowId), ["row-img-b", "row-later"]);
  assert.equal(imageReviewChoices(modal.book.redundancy.result.images[0])[0].occurrences.length, 2);
});
test("explicit checked and unchecked choices override defaults, including omit all", () => {
  const modal = setup();
  modal.book.redundancy.choices = { first: false, later: true, "image:picture:a": false, "image:picture:b": true };
  assert.equal(bookRedundancyExclusions(modal, "a").length, 3);
  assert.equal(bookRedundancyExclusions(modal, "b").length, 0);
  assert.equal(reviewChoiceIncluded({ first: false }, "first", 0), false);
});
test("reordering changes only automatic choices and unique notes are untouched", () => {
  const modal = setup();
  modal.book.redundancy.choices = { first: false };
  modal.book.redundancy.result.footnotes[0].occurrences.reverse();
  assert.equal(bookRedundancyExclusions(modal, "b").some((e) => e.kind === "footnote"), false);
  assert.equal(bookRedundancyExclusions(modal, "a").some((e) => e.kind === "footnote"), true);
  assert.deepEqual(bookRedundancyExclusions(modal, "unique"), []);
});
