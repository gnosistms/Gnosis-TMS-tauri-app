# Indent every body paragraph

Status: done (2026-11-03)

## Goal

Book chapters currently follow the Anglo-American convention: a body paragraph is
indented only when it follows another body paragraph, so the first paragraph after a
heading, quote, citation, list, separator or image starts flush. Hans finds that
inconsistent. Follow the continental convention instead: every plain body paragraph
takes the 1.5em first-line indent, except the chapter's drop-cap paragraph, which
already has its own opening.

This supersedes the "omit the indent after chapter openings, headings, separators,
and images" bullet in `plans/vellum-style-pdf-book-layout.md`.

## Scope

- PDF (`pdf_export.rs`, chapter body loop): indent a block when it is a plain
  paragraph and not the drop-cap block; drop the `indent_next` tracking.
- HTML book preview (`project-book-chapter-preview.js`): same rule for the
  `book-print-indent` class; drop `indentNext`.
- Unchanged: headings, quotes, centered/indented rows and lists (never indented);
  non-Latin chapters (no indent at all); front matter (block paragraphs); footnote
  paragraphs (first flush beside the number, later ones indented). EPUB and HTML
  exports do not indent body paragraphs, so nothing changes there.

## Tests

- Update the Rust tests that assert a flush paragraph after a citation and after a
  list, and the preview test that counts indented paragraphs.
- Render a sample PDF and check the paragraph after a heading is indented and the
  drop-cap paragraph is not.
