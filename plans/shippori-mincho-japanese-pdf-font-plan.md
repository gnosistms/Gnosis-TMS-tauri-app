# Shippori Mincho Japanese PDF Font Plan

## Goal

Use Shippori Mincho for Japanese Typst PDF exports while keeping EB Garamond as
the Latin fallback and preserving the existing persistent, versioned font
cache.

## Implementation

1. Replace the Japanese Noto Serif JP asset with pinned Shippori Mincho Regular
   and Bold assets. Regular covers body copy and Bold covers headings and strong
   text without downloading unused weights.
2. Select `Shippori Mincho` first for Japanese documents and retain `EB Garamond`
   as fallback.
3. Update the PDF export plan and generated third-party notices with the
   Shippori Mincho download size, source, copyright, and SIL OFL 1.1 text.
4. Update focused font-selection tests, compile a Japanese sample with only the
   configured fonts, render it to PNG, and visually inspect the result.

## Verification

- Focused Rust PDF-export tests pass.
- The third-party notice generator and JavaScript syntax checks pass.
- A real Typst Japanese sample compiles with Shippori Mincho Regular and Bold
  while system fonts are disabled.
- The rendered sample has legible Japanese glyphs and visibly distinct body and
  bold heading weights, with no clipping or missing-glyph boxes.
