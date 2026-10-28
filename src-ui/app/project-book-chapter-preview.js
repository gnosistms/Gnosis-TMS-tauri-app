import { renderEditorPreviewDocumentHtml, applyCustomHtmlPlainTextPolicy } from "./editor-preview.js";
import { extractInlineMarkupVisibleText } from "./editor-inline-markup/serialize.js";
import { EDITOR_ROW_TEXT_STYLE_QUOTE, normalizeEditorRowTextStyle } from "./editor-row-text-style.js";
import { bookPrintProfile } from "./project-book-print-profile.js";

const hasText = (block) => Boolean(extractInlineMarkupVisibleText(block?.text || "").trim());
const visible = (block) => block?.kind === "image" || (block?.kind === "text" && (hasText(block) || Boolean(block.attribution?.trim())));
const quote = (block) => block?.kind === "text" && normalizeEditorRowTextStyle(block.textStyle) === EDITOR_ROW_TEXT_STYLE_QUOTE && hasText(block);

// As in the PDF, a chapter that opens with a quote or an image shows it alone
// under the title and starts its text on the next page. A quote cover is the run
// of consecutive quotes (blank rows aside); an image cover is that one image.
// With nothing visible after the opener, it already has the page to itself.
function chapterCoverLength(blocks) {
  const first = blocks.findIndex(visible);
  if (first < 0) return 0;
  let length = first + 1;
  if (quote(blocks[first])) {
    for (let index = length; index < blocks.length && (quote(blocks[index]) || !visible(blocks[index])); index += 1) {
      if (quote(blocks[index])) length = index + 1;
    }
  } else if (blocks[first].kind !== "image") return 0;
  return blocks.slice(length).some(visible) ? length : 0;
}

// The chapter's pages: its text, or a cover page followed by its text. Footnotes
// keep one numbering and are listed after the text.
export function renderBookChapterPages(blocks, modal, resolveImageSrc) {
  let indentNext = false;
  let searchDropcap = bookPrintProfile(modal).latin;
  const normalized = applyCustomHtmlPlainTextPolicy(blocks, modal.omitCustomHtml)
    .map((block) => block.textStyle === "chapter_heading" ? { ...block, textStyle: "heading1" } : block);
  const cover = chapterCoverLength(normalized);
  // Cover blocks leave the drop cap to the text, which opens the next page.
  const prepared = normalized.map((block, index) => index < cover ? { ...block, bookCover: true } : block);
  const rendered = renderEditorPreviewDocumentHtml(prepared, {
    resolveImageSrc, attributionOutside: true, footnoteTextClass: "book-footnote__text",
    blockClassName(block, variant) {
      if (block.bookCover) return "";
      if (variant === "image") { indentNext = false; return ""; }
      if (variant === "separator") { indentNext = false; searchDropcap = false; return ""; }
      const text = extractInlineMarkupVisibleText(block.text || "");
      const first = text.match(/[\p{L}\p{N}]/u)?.[0];
      const plain = variant === "paragraph";
      const dropcap = searchDropcap && plain && first && /\p{L}/u.test(first);
      if (first || block.attribution?.trim()) searchDropcap = false;
      const indent = plain && indentNext && !dropcap;
      if (text.trim()) indentNext = plain;
      if (block.attribution?.trim()) indentNext = false;
      return dropcap ? "book-print-dropcap" : indent ? "book-print-indent" : "";
    },
  });
  // Book pages are a reading preview; generic editor tooltips remain elsewhere.
  const clean = (html) => html.replace(/ data-(?:preview-block|row-id|tooltip)="[^"]*"/g, "");
  const body = (html, className = "book-chapter__body") => `<div class="${className}">${clean(html)}</div>`;
  const text = `${body(rendered.blocksHtml.slice(cover).join(""))}${rendered.footnotesHtml
    ? `<div class="book-chapter__footnotes">${clean(rendered.footnotesHtml)}</div>` : ""}`;
  if (!cover) return [text];
  // Each cover quote shrinks to its text, so a one-line quote is centred.
  const coverHtml = rendered.blocksHtml.slice(0, cover)
    .map((html, index) => html && quote(prepared[index]) ? `<div class="book-chapter__epigraph">${html}</div>` : html).join("");
  const image = prepared[cover - 1].kind === "image" ? " book-chapter__cover--image" : "";
  return [body(coverHtml, `book-chapter__body book-chapter__cover${image}`), text];
}
