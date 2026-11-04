# Multi-paragraph quotes export as one quotation

## Problem

A quote row whose text has several paragraphs (blank lines between them) is
split into one block per paragraph before its style is applied, so every
paragraph becomes a quotation of its own. WordPress got four `wp:quote` blocks,
each with its own box and quote mark, and the attribution only on the last one.
The same split shapes the in-app preview, the book preview, and the HTML, EPUB,
Markdown and PDF exports (each paragraph a separate `<blockquote>` or
`#gnosis-quote`, with quote spacing between them).

## Rule

A quote row is one quotation. Its paragraphs stay paragraphs inside that one
quote, and its attribution closes the whole quote.

- Separate quote rows stay separate quotes (each may cite a different source).
- A separator (`<hr>`) inside a quote row still ends the quote, as now.
- A single-paragraph quote exports exactly as before.

## Frontend (`src-ui/app/editor-preview.js`)

The preview document keeps one block per paragraph (footnote grouping, search,
double-click editing and the book's block list all rely on it). Grouping happens
where blocks are drawn or serialized: consecutive quote blocks with the same
non-empty `rowId` belong to one quote.

- **WordPress / copied HTML**: quote text parts serialize as entries
  `{ paragraph, citation, rowId }`; `serializeEditorPreviewBlocks` merges
  consecutive entries of one row into a single
  `<!-- wp:quote --><blockquote class="wp-block-quote">` holding one
  `wp:paragraph` per paragraph (joined by a blank line, as Gutenberg's own
  serializer does) and the `<cite>` last.
- **In-app and book preview**: a quote paragraph that continues the previous
  block's quote gets `translate-preview__block--quote-continued`. CSS takes back
  the quote spacing between them and gives the continuing paragraph the body's
  first-line indent, as the PDF does (`translate.css`, `project-book.css`).
- **Book cover** (`project-book-chapter-preview.js`): only a one-paragraph quote
  is wrapped in the shrink-to-fit epigraph box; a multi-paragraph quote fills the
  width, as the PDF's one-line test leaves it.

## Backend (`chapter_export.rs`, `epub_export.rs`, `pdf_export.rs`)

`push_text_blocks_with_separators` pushes a quote segment as one
`ExportBlock::Text` whose paragraphs are joined by a blank line
(`QUOTE_PARAGRAPH_BREAK`); `quote_paragraphs` splits them again. Footnote
anchors, citations, the cover rule and the keep-short-quotes-together rule then
see one block per quote.

- **HTML / EPUB**: a multi-paragraph quote is one `<blockquote>` with a `<p>`
  per paragraph; the citation goes inside it, after the last paragraph.
- **Markdown**: one `>` block, with a bare `>` line between paragraphs.
- **TXT**: already one `<blockquote>` with a blank line between paragraphs.
- **DOCX / RTF**: one Quote-styled paragraph per paragraph, as before.
- **PDF**: the paragraphs are rendered with the block's footnotes and set inside
  one `#gnosis-quote` with paragraph breaks. Paragraphs after the first take the
  body's first-line indent (`gnosis-quote-indent`, from `paragraph_indent`), the
  book convention for multi-paragraph block quotes, since paragraph spacing
  equals the leading.

## Tests

- JS: a three-paragraph quote row with an attribution serializes to one
  `wp:quote` with three `wp:paragraph`s and one `<cite>`; two adjacent quote rows
  stay two quotes; a separator splits the quote; the preview marks continuing
  paragraphs.
- Rust: HTML, EPUB, Markdown, DOCX and PDF output for a multi-paragraph quote
  with a citation and a footnote; a single-paragraph quote is unchanged.
