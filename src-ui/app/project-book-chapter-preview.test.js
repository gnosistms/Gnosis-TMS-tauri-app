import test from "node:test";
import assert from "node:assert/strict";
import { renderBookChapterPages } from "./project-book-chapter-preview.js";
import { buildEditorPreviewDocument } from "./editor-preview.js";
const text = (textStyle, value, extra = {}) => ({ kind: "text", rowId: "row", languageCode: "en", textStyle, text: value, ...extra });
const pages = (blocks, languageCode = "en") => renderBookChapterPages(blocks, { languageCode }, () => "data:image/svg+xml,test");
const render = (blocks, languageCode) => pages(blocks, languageCode).join("");

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

test("an opening quote or image stands alone on a cover page before the chapter text", () => {
  const image = { kind: "image", image: {}, caption: "A caption" };
  const epigraph = [
    text("paragraph", ""), text("quote", "A first epigraph [1].", { attribution: "— One", footnotes: [{ marker: 1, text: "A note." }] }),
    text("paragraph", ""), text("quote", "A second epigraph."),
  ];
  const [cover, body, ...rest] = pages([...epigraph, text("paragraph", "The text [1].", { footnotes: [{ marker: 1, text: "Another." }] })]);
  assert.deepEqual(rest, []);
  assert.match(cover, /^<div class="book-chapter__body book-chapter__cover">[^]*A first epigraph[^]*— One[^]*A second epigraph[^]*<\/div>$/);
  assert.doesNotMatch(cover, /The text|book-chapter__footnotes/);
  // Each quote shrinks to its own text, with its citation, so short ones centre.
  assert.equal((cover.match(/<div class="book-chapter__epigraph"><blockquote/g) || []).length, 2);
  assert.match(cover, /<div class="book-chapter__epigraph"><blockquote[^]*<\/blockquote><cite[^]*— One<\/cite><\/div>/);
  // The text opens the next page, so it takes the drop cap the quote would not.
  assert.match(body, /<p class="[^"]*book-print-dropcap/);
  assert.doesNotMatch(cover, /book-print-dropcap/);
  // Footnotes keep one numbering across both pages and are listed after the text.
  assert.match(body, /^<div class="book-chapter__body">[^]*The text[^]*>2<\/a>[^]*book-chapter__footnotes[^]*A note\.[^]*Another\./);

  const [imageCover, imageBody] = pages([image, image, text("paragraph", "After the images.")]);
  assert.match(imageCover, /^<div class="book-chapter__body book-chapter__cover book-chapter__cover--image"><figure[^]*<\/figure><\/div>$/);
  assert.match(imageBody, /^<div class="book-chapter__body"><figure[^]*After the images\./);
  // An image cover passes the drop cap to the first paragraph, as in the PDF.
  assert.match(imageBody, /book-print-dropcap/);

  for (const blocks of [
    [text("paragraph", "An opening."), text("quote", "A quote.")],
    [text("heading2", "A heading"), image, text("paragraph", "Body.")],
    [text("quote", "Only an epigraph.", { attribution: "— One" }), text("paragraph", "")],
    [image],
  ]) assert.equal(pages(blocks).length, 1);
});

test("an attribution-only quote cites the text before it, on the cover and on the page", () => {
  const attribution = (rowId, source) => ({ rowId, textStyle: "quote", fields: { en: "" }, attributions: { en: source } });
  const [cover, body] = pages(buildEditorPreviewDocument([
    { rowId: "q", textStyle: "quote", fields: { en: "An epigraph." } }, attribution("a", "— One"),
    { rowId: "p", fields: { en: "Body text." } }, attribution("b", "— Two"),
    { rowId: "n", fields: { en: "Not indented." } },
  ], "en"));
  // On the cover it is the epigraph's own citation, inside the epigraph.
  assert.match(cover, /<div class="book-chapter__epigraph"><blockquote[^>]*>An epigraph\.<\/blockquote><cite[^>]*>— One<\/cite><\/div>/);
  // On the page it follows the body text with no empty quote, and the next
  // paragraph is not indented, as after any citation.
  assert.match(body, /<p [^>]*>Body text\.<\/p><cite[^>]*>— Two<\/cite><p [^>]*>Not indented\./);
  assert.doesNotMatch(body, /blockquote|book-print-indent/);
});
