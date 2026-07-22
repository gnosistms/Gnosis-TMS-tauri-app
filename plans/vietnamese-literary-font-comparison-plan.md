# Vietnamese Literary Font Comparison Plan

## Goal

Produce an apples-to-apples Typst specimen comparing EB Garamond, Literata,
Alegreya, and Source Serif 4 for Vietnamese literary book typography.

## Method

1. Download the official variable Roman and Italic font files into `tmp/pdfs/`.
2. Typeset the same Vietnamese title, body passage, bold text, italic text, and
   diacritic stress line on one A5 page per family.
3. Compile with Typst while system and embedded fonts are disabled.
4. Render every page to PNG, assemble a contact sheet, and visually inspect
   diacritics, line spacing, weight changes, clipping, and missing glyphs.
5. Keep the final PDF, page PNGs, contact sheet, and Typst source under
   `output/pdf/`; remove downloaded temporary fonts.
