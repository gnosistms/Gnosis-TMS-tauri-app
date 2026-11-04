# Caption and attribution paragraph breaks

Status: built on `dev`, 2026-11-04; not yet in a release.

## Goal

Image and media captions and quote attributions take returns the way row text
and footnotes do (`plans/footnote-paragraph-and-line-breaks-plan.md`, Decision
2): Return starts a paragraph, Shift+Return breaks the line.

## The rule

- Stored text follows the row rule: a blank line is a paragraph break, a run of
  blank lines is one, empty paragraphs are dropped; a single return is a line
  break.
- **Look.** Captions are centered and attributions right-aligned, so a
  first-line indent cannot mark a paragraph. A paragraph break shows as one empty
  line (two line breaks) in every preview and export, which is what the field
  shows and all a WordPress caption can hold. Vellum, which has real paragraph
  and line separators, gets those, as footnotes do.

## Today

- Every return is a line break; a blank line shows as an empty line, and a run
  of them as several.
- Your projects: 441 captions, 5 with a return (4 use single returns for title /
  artist / source lines; one hnhh caption has a blank line between a Bible quote
  and its explanation). 101 attributions, none with a return. So no migration.
- Gaps: the HTML export drops caption returns (the figcaption gets the raw
  text), the Markdown export joins caption lines into one, and the Vellum export
  makes every caption return a paragraph.

## Changes

1. **Keys.** The caption and attribution textareas carry
   `data-text-has-paragraphs`.
2. **One paragraph break.** Previews and exports collapse blank-line runs to a
   single blank line and drop empty paragraphs: JS where the preview model reads
   captions and attributions (Translate preview, book preview, WordPress, copy),
   Rust where export blocks are built (every file export).
3. **Line breaks everywhere.** HTML figcaption gets `<br>`; Markdown captions
   keep line breaks (`\` hard breaks) and paragraphs; Vellum captions map a
   paragraph break to U+000A and a line break to U+2028 (attributions already
   go through the footnote mapping).
4. **Unchanged:** print-policy media captions already become centered text
   blocks that follow the row rule; subtitle text and custom HTML keep native
   newlines.

## Tests

Keys for both fields; JS preview and WordPress caption and attribution; Vellum
caption; Rust HTML and Markdown captions and the collapsed blank-line run in
attributions; a browser test typing Return and Shift+Return into an
attribution, through save and preview.
