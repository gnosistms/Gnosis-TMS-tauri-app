import test from "node:test";
import assert from "node:assert/strict";
import { replaceSrtFragmentTexts } from "./editor-srt-group-replace.js";

test("cross-fragment replacements stay in the starting cue and preserve other text", () => {
  assert.deepEqual(replaceSrtFragmentTexts(["Visit New", "York today"], "en", "New York", "Paris", false), ["Visit Paris", " today"]);
  assert.deepEqual(replaceSrtFragmentTexts(["New", "York New", "York"], "en", "New York", "City", false), ["City", " City", ""]);
});

test("replacements respect visible markup, case, and language-aware joins", () => {
  const parts = replaceSrtFragmentTexts(["<em>New</em>", "York"], "en", "New York", "Paris", true);
  assert.deepEqual(parts, ["<em>Paris</em>", ""]);
  assert.deepEqual(replaceSrtFragmentTexts(["New", "York"], "en", "new york", "Paris", true), ["New", "York"]);
  assert.deepEqual(replaceSrtFragmentTexts(["中", "文"], "zh", "中文", "汉语", false), ["汉语", ""]);
});
