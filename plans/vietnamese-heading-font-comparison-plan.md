# Vietnamese Heading Font Comparison Plan

## Goal

Compare four heading treatments over identical EB Garamond Vietnamese body text:
EB Garamond, Cormorant Garamond, Fraunces, and Alegreya.

## Method

1. Download the official Google Fonts variable Roman files, plus EB Garamond
   Italic for body emphasis, into `tmp/pdfs/`.
2. Typeset one identical A5 literary-book page per heading family. Keep page
   geometry, body copy, body font, heading sizes, heading weight, spacing, and
   color constant.
3. Include an accented uppercase chapter label, a Vietnamese chapter title,
   and a second-level heading to expose diacritic design at multiple sizes.
4. Compile with Typst while system and embedded fonts are disabled, render all
   pages to PNG, and inspect hierarchy, accent placement, clipping, and balance.
5. Keep the final PDF, page PNGs, and Typst source in `output/pdf/`; remove
   temporary font downloads.
