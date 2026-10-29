# Attributions for body text

## Goal

A quote row with an attribution but no text is how an author attributes body
text. It should read as an attribution applied to the previous non-empty row:
set like a quote's citation, at the margin of the text it follows, with no
vertical space for the empty quote.

## Behaviour

- The empty quote produces no block anywhere (previews, PDF, EPUB, HTML, DOCX,
  RTF, Markdown, WordPress, clipboard).
- Its attribution is set as the citation of the previous visible block:
  - after a paragraph, centred or indented text: right-aligned at the body
    margin, as the last line of that text;
  - after a quote without its own attribution: exactly as that quote's own
    citation (the quote's inset; joins a chapter-cover epigraph);
  - after anything that cannot carry a citation (a heading, an image, a
    separator, custom HTML, an already cited block, or nothing): a standalone
    right-aligned citation at the body margin.
- Footnotes of the previous row do not stand between it and the citation.

## Changes

- `chapter_export.rs` `build_export_document`: stop emitting the empty owning
  `Text` block; emit only `Attribution`.
- `pdf_export.rs`: the citation lookahead and `chapter_cover_end` look past
  footnote blocks. A cited plain paragraph wraps its text in `#par`: inline
  content alone in a block is no paragraph in Typst 0.15, so it lost its
  first-line indent and justification.
- HTML and EPUB exports: set a citation inside the last text block it follows
  (paragraph or quote); otherwise a standalone right-aligned cite.
- Markdown: quote syntax only after a quote.
- `editor-preview.js` `buildEditorPreviewDocument`: attach the attribution to
  the previous citable block (`attribution` + `attributionRowId`); fall back to
  an attribution-only block rendered as a bare cite. WordPress/clipboard get a
  right-aligned attribution paragraph when the text is not a quote.
- Tests for each.
