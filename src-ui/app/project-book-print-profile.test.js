import test from "node:test";
import assert from "node:assert/strict";
import { bookPrintVariables } from "./project-book-print-profile.js";

const firstIndent = (languageCode, kind = "chapter") =>
  bookPrintVariables({ languageCode }, kind).match(/--book-first-indent:([^;]*)/)[1];

test("chapter paragraphs take each script's traditional first-line indent", () => {
  assert.equal(firstIndent("en"), "1.5em");
  assert.equal(firstIndent("vi"), "1.5em");
  assert.equal(firstIndent("zh-Hans"), "2em");
  assert.equal(firstIndent("zh_TW"), "2em");
  assert.equal(firstIndent("ja"), "1em");
  assert.equal(firstIndent("ko"), "1em");
  assert.equal(firstIndent("ar"), "1.5em");
  assert.equal(firstIndent("fa"), "1.5em");
  // Front matter is set in spaced paragraphs, not indented ones.
  assert.equal(firstIndent("zh", "dedication"), "0em");
});
