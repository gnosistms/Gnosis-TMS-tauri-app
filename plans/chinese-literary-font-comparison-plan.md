# Chinese Literary Font Comparison Plan

## Goal

Create visually consistent Typst specimens for choosing literary book fonts for
Simplified and Traditional Chinese PDF export.

## Simplified Chinese set

1. Noto Serif SC - current neutral baseline.
2. LXGW WenKai GB - warm Kaiti/Fangsong-influenced option.
3. Zhuque Fangsong - classical Fangsong option.

## Traditional Chinese set

1. Noto Serif TC - current neutral baseline.
2. LXGW WenKai TC - warm Traditional Chinese option.
3. GenWan Serif TC - nostalgic ink-on-paper Ming-style option.

## Method and verification

- Use official, pinned font releases in `tmp/pdfs/`. Do not include a Shippori
  prose page because its missing Chinese glyphs would require a misleading
  mixed-font fallback.
- Typeset the same regional-language title, prose, quotation, punctuation, bold
  sample, and region-sensitive character line on one A5 page per family.
- Compile with Typst while system and embedded fonts are disabled.
- Render and inspect every page for missing glyphs, localization, punctuation,
  clipping, density, and long-form readability.
- Keep final PDFs, page PNGs, and Typst sources in `output/pdf/`; delete temporary
  font downloads.
