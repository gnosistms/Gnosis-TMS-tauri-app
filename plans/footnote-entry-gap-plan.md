# Footnote entry gap

A user found consecutive footnotes in the PDF too close together: with
multi-paragraph notes, the first-line indent of a paragraph inside a note looks
like the start of the next note.

Our hanging-number footnote layout follows Knuth's `manmac.tex` (the format of
*The TeXbook*), whose `\footnote` macro begins every note with `\smallskip`
(3pt plus 1pt minus 1pt on 9pt baselines): a third of a footnote line between
notes. We copied the hanging number but not the skip. Typst's default
`footnote.entry` gap (0.5em) adds only 0.86pt over the footnotes' own 0.5em
leading, about 8% of a line.

## Measurements (Typst 0.15.1, Crimson Pro, 11.5pt body)

- Footnote text is 0.85em (9.78pt); its leading is 0.5em of that (4.89pt);
  baseline-to-baseline inside a note is 10.5pt.
- `footnote.entry`'s `gap` is measured like leading (last baseline to the next
  note's cap height), and its `em` is the body text's, not the footnote text's:
  `gap: 0.5em` and `gap: 5.75pt` render identically.

## Change

1. PDF: set `footnote.entry(gap: 0.73em)` (8.4pt): the 0.425em footnote
   leading plus 0.305em, a third of a Crimson Pro footnote line. In
   non-Latin scripts (11pt body, taller line) the extra is about 29% of a line.
2. Book preview: footnote list items get the same extra as their bottom margin,
   expressed in footnote ems: (0.73 / 0.85) − 0.5 ≈ 0.36em (was 0.5em, which
   already did not match the PDF).
3. Update the preamble unit test; render a sample page and measure the
   baseline pitch inside and across notes.

## Verification

- Rendered a sample A5 page (two multi-paragraph notes and a one-line note)
  with the bundled Typst and Crimson Pro: baselines are 42px apart inside a note
  and 56px across notes at 288ppi (10.5pt vs 14pt, a third of a line extra);
  before the change they were 42px and 45px.
- `cargo test --lib typst_footnote` passes (2 tests).
- The book preview typography browser test now has two notes and checks the
  first note's bottom margin is 0.36 footnote ems; it passes in Chrome.
- Not rendered: non-Latin scripts (same gap, about 29% of their taller line).
