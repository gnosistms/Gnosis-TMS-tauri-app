# EB Garamond Heading Weight Comparison Plan

## Goal

Compare lighter same-family headings against the preferred contrasting heading
option over identical EB Garamond Vietnamese body text.

## Variants

1. EB Garamond Regular (400) headings.
2. EB Garamond Medium (500) headings.
3. Cormorant Garamond Semibold (600) headings.

## Method and verification

- Use official pinned Google Fonts variable Roman files and EB Garamond Italic.
- Keep A5 page geometry, body copy, heading sizes, spacing, and colors identical.
- Include uppercase and mixed-case Vietnamese headings at two display sizes.
- Compile with system and embedded fonts disabled, render all pages, and inspect
  accent placement, hierarchy, clipping, and perceived weight.
- Keep the final PDF, PNG pages, and Typst source under `output/pdf/`; delete
  temporary downloaded fonts.
