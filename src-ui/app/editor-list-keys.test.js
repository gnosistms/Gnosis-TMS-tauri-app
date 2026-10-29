import test from "node:test";
import assert from "node:assert/strict";

import { listIndentEdit, listReturnEdit } from "./editor-list-keys.js";

function apply(value, edit) {
  const next = value.slice(0, edit.start) + edit.text + value.slice(edit.end);
  return `${next.slice(0, edit.selectionStart)}|${next.slice(edit.selectionStart)}`;
}

test("Return starts an item at the current level", () => {
  const value = "One\n\tTwo";
  assert.equal(apply(value, listReturnEdit(value, value.length, value.length)), "One\n\tTwo\n\t|");
  assert.equal(apply(value, listReturnEdit(value, 2, 3)), "On\n|\n\tTwo");
});

test("Return on an empty indented item outdents it", () => {
  const value = "One\n\tTwo\n\t\t";
  assert.equal(apply(value, listReturnEdit(value, value.length, value.length)), "One\n\tTwo\n\t|");
  const flat = "One\n";
  assert.equal(apply(flat, listReturnEdit(flat, flat.length, flat.length)), "One\n\n|");
});

test("Tab indents at most one level below the item above", () => {
  const value = "One\n\tTwo\nThree";
  const caret = value.indexOf("Three") + 2;
  assert.equal(apply(value, listIndentEdit(value, caret, caret)), "One\n\tTwo\n\tTh|ree");
  const nested = "One\n\tTwo\n\tThree";
  const nestedCaret = nested.length;
  assert.equal(apply(nested, listIndentEdit(nested, nestedCaret, nestedCaret)), "One\n\tTwo\n\t\tThree|");
  assert.equal(listIndentEdit("One\n\tTwo", 0, 0), null, "the first item cannot be indented");
  assert.equal(listIndentEdit("One\n\tTwo", 6, 6), null, "an item already one level below cannot go deeper");
});

test("Tab indents a new empty item", () => {
  const value = "One\n";
  assert.equal(apply(value, listIndentEdit(value, value.length, value.length)), "One\n\t|");
  const nested = "One\n\t";
  assert.equal(apply(nested, listIndentEdit(nested, nested.length, nested.length, true)), "One\n|");
});

test("Tab and Shift+Tab move every line the selection touches", () => {
  const value = "One\nTwo\nThree\n";
  const start = value.indexOf("Two");
  const end = value.length;
  const indented = listIndentEdit(value, start, end);
  assert.equal(indented.text, "\tTwo\n\tThree");
  assert.equal(indented.selectionStart, start + 1);
  assert.equal(indented.selectionEnd, end + 2);
  const next = value.slice(0, indented.start) + indented.text + value.slice(indented.end);
  const outdented = listIndentEdit(next, indented.selectionStart, indented.selectionEnd, true);
  assert.equal(outdented.text, "Two\nThree");
  assert.equal(outdented.selectionStart, start);
  assert.equal(outdented.selectionEnd, end);
});

test("Shift+Tab leaves top-level items and blank lines alone", () => {
  assert.equal(listIndentEdit("One\n\nTwo", 0, 8, true), null);
  const value = "One\n\tTwo";
  assert.equal(apply(value, listIndentEdit(value, value.length, value.length, true)), "One\nTwo|");
  assert.equal(apply(value, listIndentEdit(value, 4, 4, true)), "One\n|Two");
});
