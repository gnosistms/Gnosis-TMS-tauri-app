# Heading style parity: editor and previews follow the PDF export

## Problem

The Typst PDF export sets body headings differently by script
(`typst_preamble` and `latin_body` in
`src-tauri/src/project_import/chapter_editor/pdf_export.rs`):

- Latin-script languages: regular-weight capitals, H1 14.5pt and H2 12pt over
  an 11.5pt body.
- Japanese, Korean, Chinese, Arabic, Persian: no heading rule, so Typst's
  default bold headings at 1.4em and 1.2em.

The editor shows every heading in bold mixed case at 1.4× and 1.18×, and the
chapter HTML preview shows every heading in regular capitals at the old 13/12
ratio. A user only finds out how headings really look when they export.

The book preview (`project-book-print-profile.js`) already follows the export.

## Change

`src-ui/styles/translate.css`

- Define heading variables (`--heading1-scale`, `--heading2-scale`,
  `--heading-weight`, `--heading-case`) on editor fields, their highlight
  overlays, static fields, and preview blocks. The defaults are the Latin
  style; elements whose `lang` starts with `ja`, `ko`, `zh`, `ar` or `fa`
  (the same prefixes as `latin_body`) switch to the Typst defaults.
- The editor heading rules and the chapter preview heading rules both read
  those variables, so the language split lives in one place.
- Typefaces stay as they are. The editor and chapter preview use Noto Serif
  throughout; only the book preview loads the print fonts.

The book preview's own `.book-page--chapter` rules are more specific and keep
overriding the chapter preview rules.

Non-Latin body text in the editor and preview is set at weight 550
(`--editor-non-latin-serif-weight`) because the Noto CJK and Arabic serifs look
thin at 400. That rule outranks the plain preview heading rule, so a preview-only
weight rule after it keeps non-Latin preview headings bold. It ties with the
book preview's heading rules, and `project-book.css` loads later, so the book
preview keeps its own weights.

## Tests

- `tests/browser/editor-regression.spec.js`: the row text style test expects a
  Latin heading to be regular-weight capitals with H1 larger than H2.
- `tests/browser/project-export.spec.js`: the book preview H1 ratio becomes
  14.5 / 11.5 (missed when the export H1 changed).
