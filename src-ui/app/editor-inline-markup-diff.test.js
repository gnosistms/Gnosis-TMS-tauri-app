import test from "node:test";
import assert from "node:assert/strict";

import {
  buildInlineMarkupDiff,
  extractInlineMarkupVisibleText,
  renderSanitizedInlineMarkupWithRanges,
} from "./editor-inline-markup.js";

function changedText(diff) {
  const visibleText = extractInlineMarkupVisibleText(diff.markup);
  return diff.ranges.map((range) => [range.change, visibleText.slice(range.start, range.end), range.note]);
}

test("unchanged markup has no changes and round-trips", () => {
  const diff = buildInlineMarkupDiff("El <strong>gato</strong> negro", "El <strong>gato</strong> negro");
  assert.equal(diff.hasChanges, false);
  assert.deepEqual(diff.ranges, []);
  assert.equal(diff.markup, "El <strong>gato</strong> negro");
});

test("merged text keeps deleted and inserted runs in order", () => {
  const diff = buildInlineMarkupDiff("El gato negro", "El gato blanco");
  assert.equal(extractInlineMarkupVisibleText(diff.markup), "El gato negroblanco");
  assert.deepEqual(changedText(diff), [["delete", "negro", ""], ["insert", "blanco", ""]]);
});

test("deleted text keeps its old formatting and inserted text its new formatting", () => {
  const diff = buildInlineMarkupDiff("uno <strong>dos</strong>", "uno <em>tres</em>");
  assert.equal(diff.markup, "uno <strong>dos</strong><em>tres</em>");
  assert.deepEqual(changedText(diff), [["delete", "dos", ""], ["insert", "tres", ""]]);
});

test("formatting-only change is a format run that names the old formatting", () => {
  const diff = buildInlineMarkupDiff("El <em>gato</em> negro", "El <strong>gato</strong> negro");
  assert.equal(diff.markup, "El <strong>gato</strong> negro");
  assert.deepEqual(changedText(diff), [["format", "gato", "was: italic"]]);
});

test("adding formatting to plain text says it had none", () => {
  const diff = buildInlineMarkupDiff("El gato", "El <u>gato</u>");
  assert.deepEqual(changedText(diff), [["format", "gato", "was: no formatting"]]);
});

test("changed link target is a format change", () => {
  const diff = buildInlineMarkupDiff(
    'ver <a href="https://a.example">aquí</a>',
    'ver <a href="https://b.example">aquí</a>',
  );
  assert.deepEqual(changedText(diff), [["format", "aquí", "was: link to https://a.example"]]);
});

test("ruby element is one unit and survives the merge", () => {
  const ruby = "<ruby>漢字<rt>かんじ</rt></ruby>";
  const diff = buildInlineMarkupDiff(`Hola ${ruby}`, `Hola ${ruby} fin`);
  assert.equal(diff.markup, `Hola ${ruby} fin`);
  assert.deepEqual(changedText(diff), [["insert", " fin", ""]]);
});

test("added and removed text diff against empty", () => {
  assert.deepEqual(changedText(buildInlineMarkupDiff("", "nuevo")), [["insert", "nuevo", ""]]);
  assert.deepEqual(changedText(buildInlineMarkupDiff("viejo", "")), [["delete", "viejo", ""]]);
});

test("astral characters are diffed whole", () => {
  const diff = buildInlineMarkupDiff("a 😀 b", "a 😃 b");
  assert.deepEqual(changedText(diff), [["delete", "😀", ""], ["insert", "😃", ""]]);
});

test("deleted tag-like text stays escaped when rendered", () => {
  const diff = buildInlineMarkupDiff("<script>alert(1)</script>", "hola");
  const html = renderSanitizedInlineMarkupWithRanges(diff.markup, diff.ranges);
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("formatting part of a word marks only that part", () => {
  const diff = buildInlineMarkupDiff("traducción", "tra<strong>ducción</strong>");
  assert.deepEqual(changedText(diff), [["format", "ducción", "was: no formatting"]]);
});

test("text without spaces is still diffed by word, not by letter", () => {
  const diff = buildInlineMarkupDiff("我喜欢猫", "我喜欢狗");
  assert.equal(extractInlineMarkupVisibleText(diff.markup).length, 5);
  assert.deepEqual(changedText(diff).map(([change]) => change), ["delete", "insert"]);
});

test("Persian: a replaced word reads as one deleted and one inserted word", () => {
  const diff = buildInlineMarkupDiff("من کتاب را خواندم", "من مقاله را خواندم");
  assert.deepEqual(changedText(diff), [["delete", "کتاب", ""], ["insert", "مقاله", ""]]);
});

test("Persian: a word joined with a zero-width non-joiner stays one word", () => {
  const diff = buildInlineMarkupDiff("من می‌خواهم بروم", "من نمی‌خواهم بروم");
  assert.deepEqual(changedText(diff), [
    ["delete", "می‌خواهم", ""],
    ["insert", "نمی‌خواهم", ""],
  ]);
});

test("Persian: an added short-vowel mark replaces the whole word, never a stray mark", () => {
  const diff = buildInlineMarkupDiff("کتاب", "کِتاب");
  assert.deepEqual(changedText(diff), [["delete", "کتاب", ""], ["insert", "کِتاب", ""]]);
});

test("Persian: formatting a word and changing Persian numerals", () => {
  assert.deepEqual(
    changedText(buildInlineMarkupDiff("کتاب خوب", "کتاب <strong>خوب</strong>")),
    [["format", "خوب", "was: no formatting"]],
  );
  assert.deepEqual(
    changedText(buildInlineMarkupDiff("سال ۱۴۰۲", "سال ۱۴۰۳")),
    [["delete", "۱۴۰۲", ""], ["insert", "۱۴۰۳", ""]],
  );
});
