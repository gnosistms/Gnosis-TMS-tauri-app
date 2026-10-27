import test from "node:test";
import assert from "node:assert/strict";
import { toggleSrtGroupInlineStyle } from "./editor-srt-group-formatting.js";
import { normalizeSrtGroupText } from "./editor-srt-group-text.js";

test("formatting across a cue boundary leaves each cue valid standalone markup", () => {
  const value = "<em>one</em>⟦1⟧two";
  const options = { value, selectionStart: 0, selectionEnd: value.length, style: "italic", languageCode: "en" };
  const result = toggleSrtGroupInlineStyle(options, ["⟦1⟧"]);
  assert.deepEqual(normalizeSrtGroupText(result.value, ["⟦1⟧"]).parts, ["<em>one</em>", "<em>two</em>"]);
  const removed = toggleSrtGroupInlineStyle({ ...options, value: result.value, selectionEnd: result.value.length }, ["⟦1⟧"]);
  assert.equal(removed.value, "one⟦1⟧two");
});

test("formatting does not restore deleted markers and ruby stays within a fragment", () => {
  const result = toggleSrtGroupInlineStyle({ value: "one two", selectionStart: 0, selectionEnd: 7, style: "bold", languageCode: "en" }, ["⟦1⟧"]);
  assert.equal(result.value, "<strong>one two</strong>");
  assert.ok(toggleSrtGroupInlineStyle({ value: "one⟦1⟧two", selectionStart: 0, selectionEnd: 9, style: "ruby", languageCode: "en" }, ["⟦1⟧"]).error);
});
