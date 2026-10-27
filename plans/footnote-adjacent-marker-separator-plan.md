# Adjacent Footnote Marker Separator

## Problem

Two footnote markers at the same point (`[1][2]` in row text) render as two bare
superscript numbers touching each other on every superscript surface: `¹²`, which
reads as footnote 12. The same collision happens between an inline marker at the
end of a row and an appended row-level footnote reference.

## Decision (2026-08-06)

Insert a **superscript comma** between strictly adjacent markers, at render time
only — the stored chapter text is never changed. This follows the dominant
convention for bare superscript markers:

- LaTeX `footmisc` `multiple` option and KOMA-Script both insert a superscript
  comma (`\multfootsep`, default `,`) between strictly adjacent footnote marks.
- AMA / scientific journal style prescribes superscript commas with no spaces
  (`¹,²`).
- Typst has an open feature request (typst/typst#2967) and an open PR (#7627)
  to do the same automatically; the endorsed workaround today is `#super[,]`.

Adjacency rule: **strictly adjacent only** — nothing, not even a space, between
the two markers in the visible text. A deliberately typed `[1] [2]` keeps its
space and gets no comma (matches footmisc's detection behavior). Appended
row-level references count as adjacent to a marker that ends the text and to
each other, because their placement is renderer-generated, not typed.

## Scope — the three superscript emitters

1. **Preview + HTML clipboard + WordPress** — `src-ui/app/editor-preview.js`
   (one shared emitter, both `serialize` shapes, ~lines 478–525).
   - Comma between adjacent inline markers.
   - Comma between an inline marker that ends the text and the first appended
     reference (currently concatenated with nothing).
   - Comma joining multiple appended references (currently joined with `" "`).
   - The comma is real markup (`<sup>,</sup>` with a class), not CSS, because
     exported HTML and WordPress render under other stylesheets.
2. **Editor rows** — `src-ui/app/editor-static-footnote-markers.js`.
   Annotate marker ranges that start exactly where the previous marker range
   ends; the mark renderer prepends a separator `<sup>`. New CSS rule zeroes the
   `margin-left` nudge on the separator so the comma hugs the preceding number.
3. **PDF (Typst)** — `render_inline_typst_with_footnotes` in
   `src-tauri/src/project_import/chapter_editor/pdf_export.rs`.
   Track whether the last emission was a `#footnote[..]`; when the next footnote
   follows with no intervening text, emit `#super[,]` first. Covers both the
   inline loop and the appended row-level loop. Leave a comment noting that our
   separator must be removed if a future Typst release lands automatic
   adjacent-footnote grouping (typst/typst#7627).

## Non-goals (explicitly decided)

- **Vellum export** — Vellum renders and numbers its own footnote attachments;
  it handles adjacent markers itself. No change.
- **Markdown export** — `[^1][^2]` has no separator convention and no
  misreading concern in this format. No change.
- **Bracketed formats** (plain-text clipboard, TXT, HTML file export, DOCX,
  RTF, XLSX) — literal `[1][2]` brackets self-disambiguate. No change.
- **AMA-style ranges** (`¹⁻³`) — not wanted; every marker is listed
  individually.
- No normalization of user-typed spaces between markers.

## Tests

- `src-ui/app/editor-preview.test.js` — update the appended-refs join
  expectation (was `" "`), add strict-adjacent inline case and
  inline-then-appended case for both serialize and preview shapes.
- `src-ui/app/editor-row-render.test.js` — add strict-adjacent `foo[1][2]`
  case; the existing `foo [1] [2]` case still expects no comma.
- `src-tauri/.../pdf_export.rs` — add tests for adjacent inline markers,
  space-separated markers (no comma), inline marker + appended note, and two
  appended notes.

## Verification

`npm test` and `cargo test` (pdf_export module) both green.
