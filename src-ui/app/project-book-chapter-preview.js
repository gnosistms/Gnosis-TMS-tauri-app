import { renderEditorPreviewDocumentHtml, applyCustomHtmlPlainTextPolicy } from "./editor-preview.js";
import { extractInlineMarkupVisibleText } from "./editor-inline-markup/serialize.js";
import { bookPrintProfile } from "./project-book-print-profile.js";

export function renderBookChapterBody(blocks, modal, resolveImageSrc) {
  let indentNext = false;
  let searchDropcap = bookPrintProfile(modal).latin;
  const prepared = applyCustomHtmlPlainTextPolicy(blocks, modal.omitCustomHtml)
    .map((block) => block.textStyle === "chapter_heading" ? { ...block, textStyle: "heading1" } : block);
  const rendered = renderEditorPreviewDocumentHtml(prepared, {
    resolveImageSrc, attributionOutside: true, footnoteTextClass: "book-footnote__text",
    blockClassName(block, variant) {
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
  return `<div class="book-chapter__body">${clean(rendered.bodyHtml)}</div>${rendered.footnotesHtml
    ? `<div class="book-chapter__footnotes">${clean(rendered.footnotesHtml)}</div>` : ""}`;
}
