import test from "node:test";
import assert from "node:assert/strict";
import { renderBookChapterBody } from "./project-book-chapter-preview.js";
const text = (textStyle, value, extra = {}) => ({ kind: "text", rowId: "row", languageCode: "en", textStyle, text: value, ...extra });
const render = (blocks, languageCode = "en") => renderBookChapterBody(blocks, { languageCode }, () => "data:image/svg+xml,test");

test("book paragraphs follow print drop-cap and indentation boundaries", () => {
  const html = render([
    text("paragraph", "An opening."), text("paragraph", "An indented paragraph."),
    text("heading1", "A mixed-case heading"), text("paragraph", "No indent after a heading."),
    text("paragraph", "Indented again."),
    text("quote", "A quotation.", { attribution: "— An author" }),
    text("paragraph", "No indent after attribution."),
    { kind: "image", image: {}, caption: "A caption" }, text("paragraph", "No indent after an image."),
  ]);
  assert.equal((html.match(/book-print-dropcap/g) || []).length, 1);
  assert.equal((html.match(/book-print-indent/g) || []).length, 2);
  assert.match(html, /<h1[^>]*>A mixed-case heading<\/h1>/);
  assert.match(html, /<\/blockquote><cite[^>]*>— An author<\/cite>/);
  assert.doesNotMatch(html, /data-tooltip|data-preview-block/);
});

test("opening headings and non-Latin chapters omit drop caps, and notes have a separate hanging area", () => {
  assert.doesNotMatch(render([text("heading2", "A heading"), text("paragraph", "Body")]), /book-print-dropcap/);
  assert.doesNotMatch(render([text("paragraph", "日本語")], "ja"), /book-print-dropcap/);
  const html = render([text("paragraph", "A reference [1].", { footnotes: [{ marker: 1, text: "A <i>styled</i> note." }] })]);
  assert.match(html, /book-chapter__footnotes[^]*book-footnote__text[^]*<em>styled<\/em>/);
  assert.match(html, /translate-preview__footnote-ref/);
});

test("book export preview indents subsequent footnote paragraphs without adding blank lines", () => {
  const html = render([text("paragraph", "Body [1]", { footnotes: [{ marker: 1, text: "<i>First\nSecond</i>" }] })]);
  assert.match(html, /book-footnote__text[^]*text-indent:0"><em>First<\/em><\/p><p[^>]*text-indent:1.5em"><em>Second<\/em>/);
});
