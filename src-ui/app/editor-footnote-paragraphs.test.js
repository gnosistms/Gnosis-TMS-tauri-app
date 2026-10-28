import test from "node:test";
import assert from "node:assert/strict";
import { footnoteParagraphsHtml } from "./editor-footnote-paragraphs.js";
import { renderSanitizedInlineMarkupHtml } from "./editor-inline-markup.js";

test("footnote paragraphs indent continuations and keep cross-paragraph markup balanced", () => {
  const html = footnoteParagraphsHtml(renderSanitizedInlineMarkupHtml('<i>First\nSecond <a href="https://example.com">link</a></i>'));
  assert.match(html, /text-indent:0"><em>First<\/em><\/span><span[^>]+text-indent:1.5em"><em>Second/);
  assert.match(html, /<a href="https:\/\/example.com">link<\/a><\/em><\/span>$/);
  assert.equal(html.includes("\n"), false, "structural boundaries must not create additional pre-wrap blank lines");
});

test("footnote paragraph layout preserves empty paragraphs and CRLF boundaries", () => {
  const html = footnoteParagraphsHtml("First\r\n\r\nThird\r\n", "p");
  assert.equal((html.match(/<p /g) || []).length, 4);
  assert.equal((html.match(/<br>/g) || []).length, 2);
});

test("single-paragraph footnotes retain their existing markup and sanitization", () => {
  const html = renderSanitizedInlineMarkupHtml('<script>alert(1)</script> <i>note</i>');
  assert.equal(footnoteParagraphsHtml(html), html);
});
