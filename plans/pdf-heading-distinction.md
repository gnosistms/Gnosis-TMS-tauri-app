# Distinguish PDF headings from body text

Latin-script PDF exports set H2 in Alegreya at 11.5pt, the same size as the
Crimson Pro body, with less space below it than between body lines, so H2 reads
as a first line in another face. Book chapters also wrap each H1 in a block for
its contents entry, which replaces the heading's own spacing (1.3em above, 0.5em
below) with ordinary paragraph spacing, leaving H1 less room above than H2.

1. Emit a book chapter's H1 contents metadata directly before the heading instead
   of in a wrapping block. Typst 0.15.1 carries the zero-size metadata forward
   with the sticky heading, so the contents page number stays correct.
   Add a test that sweeps an H1 across a page break and checks that each entry
   lands on its heading's page.
2. Set Latin-script PDF headings in capitals (`#show heading: upper`) and raise H2
   to 12pt; H1 stays 13pt, chapter titles 16pt.
3. Match the previews: the book composer's chapter pages (caps, H2 at 12/11.5em)
   and the editor's Preview mode (caps, regular weight, sizes in the same ratio
   to body text). Editing fields are not previews and keep their styling.
4. Run the PDF export tests with the Typst layout checks, the frontend suite, and
   check both previews in the browser. Regenerate the HNHH chapter 4 sample.

Completed. In the regenerated chapter 4 sample, the baseline gap above an H1 is
25.2pt (was 17.3pt, barely more than a body line), and H2 sits at 12pt capitals
with 23.2pt above. The font-review fixture now compares the H2 excerpt with a
12pt reference glyph.

Validation: all 73 PDF export tests pass with `GNOSIS_TYPST_BIN` and
`GNOSIS_TYPST_SMOKE_FONT_DIR` set, including the new H1 page sweep. All 3,225
frontend and 26 workflow tests pass. All 39 project-export browser tests pass,
including the book preview typography check. Editor Preview mode was checked in the
dev server: capitals at 13/11.5 and 12/11.5 of body size, regular weight.

Not changed: a heading followed by a quote attribution is still wrapped in a sticky
block, which replaces its spacing the same way; editing fields keep their bold,
larger heading styling.

5. Space below headings. A comparison of 0.5em (current), one body leading (9pt),
   and 12pt below H1/H2 chose one body leading: a heading then sits one ordinary
   line above its text (15.6pt baseline to baseline, as between body lines) while
   the 23–25pt above keeps it grouped with what follows. The PDF writes it as
   body size × leading (`11.5pt * 0.78`), because `em` in the heading rule follows
   the heading's own size. The book preview drops the heading's bottom margin where
   untrimmed line boxes already hold the leading, and uses .78 of the body size
   where text boxes are trimmed. Editor Preview mode already spaces a heading from
   its text by the same gap it uses between paragraphs, so it needs no change.

   Validation: all 73 PDF export tests pass with the Typst layout checks; all 39
   project-export browser tests pass, now also checking each heading's bottom
   margin. The regenerated chapter 4 sample measures 15.6pt from every heading to
   its text, equal to the body line pitch.

Validation on the branch from main: rustfmt and strict Clippy are clean; all 992
Rust tests pass with the Typst layout checks enabled; all 3,226 frontend and 25
workflow tests pass; all 39 project-export browser tests pass. ESLint reports no
errors, and its existing warnings are outside the changed files.
