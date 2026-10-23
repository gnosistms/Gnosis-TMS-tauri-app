import test from "node:test";
import assert from "node:assert/strict";
import { createSrtGroupText, normalizeSrtGroupText, joinSrtFragmentTexts, locateSrtGroupPosition } from "./editor-srt-group-text.js";

test("group text round trips exact whitespace, markup, empty cues and literal marker text", () => {
  const parts = [" <em>Hello</em>⟦1⟧\n", "", "世界 "];
  const spec = createSrtGroupText(parts);
  assert.deepEqual(normalizeSrtGroupText(spec.text, spec.markers).parts, parts);
  assert.ok(spec.markers.every((marker) => marker.startsWith("⟦#")));
});

test("missing markers assign all text to the earliest fragment in each run", () => {
  const markers = ["⟦1⟧", "⟦2⟧", "⟦3⟧"];
  assert.deepEqual(normalizeSrtGroupText("ab⟦2⟧cd", markers).parts, ["ab", "", "cd", ""]);
  assert.deepEqual(normalizeSrtGroupText("abcd", markers).parts, ["abcd", "", "", ""]);
  assert.deepEqual(normalizeSrtGroupText("", markers).parts, ["", "", "", ""]);
  assert.deepEqual(normalizeSrtGroupText("a⟦1⟧bcd", markers).parts, ["a", "bcd", "", ""]);
  assert.equal(normalizeSrtGroupText("ab⟦2⟧cd", markers).text, "ab⟦1⟧⟦2⟧cd⟦3⟧");
});

test("duplicate or reordered markers fail without returning an assignment", () => {
  for (const value of ["a⟦1⟧b⟦1⟧c", "a⟦2⟧b⟦1⟧c"]) {
    const result = normalizeSrtGroupText(value, ["⟦1⟧", "⟦2⟧"]);
    assert.ok(result.error);
    assert.equal(result.parts, undefined);
  }
});

test("linguistic projection joins words without adding CJK spacing", () => {
  assert.equal(joinSrtFragmentTexts(["Hello", "", "world"], "en"), "Hello world");
  assert.equal(joinSrtFragmentTexts(["Hello ", "world"], "en"), "Hello world");
  assert.equal(joinSrtFragmentTexts(["中", "文"], "zh-CN"), "中文");
});

test("fragment ownership follows surviving boundaries even before deleted markers are restored", () => {
  const markers = ["⟦1⟧", "⟦2⟧"];
  assert.deepEqual(locateSrtGroupPosition("ab⟦2⟧cd", markers, 1), { fragment: 0, offset: 1 });
  assert.deepEqual(locateSrtGroupPosition("ab⟦2⟧cd", markers, 6), { fragment: 2, offset: 1 });
  assert.equal(locateSrtGroupPosition("ab⟦2⟧cd", markers, 3), null);
  assert.equal(locateSrtGroupPosition("a⟦2⟧b⟦1⟧c", markers, 0), null);
});

test("pasted formatting spanning a boundary is balanced independently in every saved cue", () => {
  assert.deepEqual(normalizeSrtGroupText("<em>hello⟦1⟧world</em>", ["⟦1⟧"]).parts, ["<em>hello</em>", "<em>world</em>"]);
  assert.deepEqual(normalizeSrtGroupText('<a href="https://example.com">a⟦1⟧b</a>', ["⟦1⟧"]).parts,
    ['<a href="https://example.com">a</a>', '<a href="https://example.com">b</a>']);
  assert.deepEqual(locateSrtGroupPosition("<em>a⟦1⟧b</em>", ["⟦1⟧"], 8), { fragment: 1, offset: 4 });
});
