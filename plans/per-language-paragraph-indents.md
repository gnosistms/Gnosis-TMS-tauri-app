# Per-language paragraph indents

Status: done (2026-11-03)

## Goal

Japanese, Korean, Chinese, Arabic and Persian book chapters currently get neither a
first-line indent nor space between paragraphs, so nothing marks a new paragraph.
Give every body paragraph the indent its script's book tradition uses, with no
space between paragraphs, as Latin-script chapters already do
(`plans/indent-every-body-paragraph.md`). Users publishing in these languages are
expected to ask for adjustments; these are defaults.

| Language | Indent | Source |
|---|---|---|
| Chinese (Simplified and Traditional) | 2em | W3C clreq: nearly all books indent every paragraph two characters |
| Japanese | 1em | W3C jlreq: a full-width indent on every paragraph |
| Korean | 1em | W3C klreq: every paragraph, one character width, is most common |
| Arabic, Persian | 1.5em (right side) | No standard; publisher guides use about 0.5 cm on the right |
| Everything else | 1.5em | Unchanged |

None of these scripts takes the Latin drop cap, so their first paragraph is
indented too.

## Scope

- PDF (`pdf_export.rs`): a `paragraph_indent` function gives the amount per
  language; the per-block `first-line-indent` is set for every language, not only
  Latin-script ones.
- Book composer pages (`project-book-print-profile.js`): `--book-first-indent`
  takes the same per-language amount.
- Editor Preview tab (`translate.css`): every body paragraph is indented by the
  same amounts, and consecutive paragraphs drop the document gap for all
  languages.
- Not in scope: Japanese paragraphs opening with 「 (publishers differ), Arabic
  kashida justification, and Hebrew, which is right-to-left but currently set
  left-to-right.

## Tests

- Rust: the per-block indent for zh, ja, ko, ar and fa chapters.
- JS: `--book-first-indent` per language.
- Render Chinese, Japanese and Arabic sample PDFs and check the editor Preview in
  the browser pane.
