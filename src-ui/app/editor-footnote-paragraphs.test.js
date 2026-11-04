import test from "node:test";
import assert from "node:assert/strict";
import { footnoteParagraphsHtml, rowTextParagraphsHtml } from "./editor-footnote-paragraphs.js";
import { renderSanitizedInlineMarkupHtml } from "./editor-inline-markup.js";

test("footnote paragraphs split at blank lines, indent continuations and keep markup balanced", () => {
  const html = footnoteParagraphsHtml(renderSanitizedInlineMarkupHtml('<i>First\n\nSecond <a href="https://example.com">link</a></i>'));
  assert.match(html, /text-indent:0"><em>First<\/em><\/span><span[^>]+text-indent:1.5em"><em>Second/);
  assert.match(html, /<a href="https:\/\/example.com">link<\/a><\/em><\/span>$/);
  assert.equal(html.includes("\n"), false, "structural boundaries must not create additional pre-wrap blank lines");
});

test("a single return in a footnote is a line break inside its paragraph", () => {
  assert.equal(footnoteParagraphsHtml("<em>Line one,\nline two.</em>"), "<em>Line one,<br>line two.</em>");
  const html = footnoteParagraphsHtml("Intro:\n\n<em>One,\nTwo.</em>\n\nAfter.", "p");
  assert.equal((html.match(/<p /g) || []).length, 3);
  assert.match(html, /text-indent:1.5em"><em>One,<br>Two\.<\/em><\/p>/);
});

test("runs of blank lines and CRLF make one paragraph break, and empty paragraphs are dropped", () => {
  const html = footnoteParagraphsHtml("First\r\n\r\n \r\n\r\nThird\r\n", "p");
  assert.equal((html.match(/<p /g) || []).length, 2);
  assert.equal(html.includes("<br>"), false);
  assert.equal(footnoteParagraphsHtml("\n\n"), "");
});

test("single-paragraph footnotes retain their existing markup and sanitization", () => {
  const html = renderSanitizedInlineMarkupHtml('<script>alert(1)</script> <i>note</i>');
  assert.equal(footnoteParagraphsHtml(html), html);
});

const rowParagraphs = (html) => [...html.matchAll(/<span class="translation-language-panel__paragraph">(.*?)<\/span>(?=<span class="translation-language-panel__paragraph">|$)/gs)]
  .map((match) => match[1]);

test("row text displays a paragraph per blank line and keeps single returns as line breaks", () => {
  const html = rowTextParagraphsHtml(renderSanitizedInlineMarkupHtml("Line one\nline <em>two\n\nthree</em>\n \n\nFour"));
  assert.deepEqual(rowParagraphs(html), ["Line one\nline <em>two</em>", "<em>three</em>", "Four"]);
  assert.equal(rowTextParagraphsHtml("No blank line\nhere"), "No blank line\nhere");
});

test("a separator between returns is content, not a blank line", () => {
  const html = renderSanitizedInlineMarkupHtml("A\n<hr>\nB");
  assert.equal(rowParagraphs(rowTextParagraphsHtml(html)).length, 1);
  const alone = rowTextParagraphsHtml(renderSanitizedInlineMarkupHtml("A\n\n<hr>\n\nB"));
  assert.equal(rowParagraphs(alone).length, 3);
  assert.match(rowParagraphs(alone)[1], /role="separator"/);
});
