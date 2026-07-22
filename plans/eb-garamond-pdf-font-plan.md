# EB Garamond PDF Font Plan

## Goal

Replace CMU Serif with EB Garamond for Latin-script Typst PDF typography,
including Vietnamese, while preserving the existing on-demand persistent font
cache and Shippori Mincho for Japanese.

## Implementation

1. Pin the official EB Garamond variable Roman and Italic TTF assets, including
   their byte sizes and SHA-256 hashes.
2. Use EB Garamond for Latin documents and as the Latin fallback for CJK and
   Arabic-script documents.
3. Update the PDF export design plan, download estimates, focused tests, and
   generated SIL OFL notices.
4. Compile and visually inspect a Vietnamese export with system and embedded
   fonts disabled, then run the focused Rust and repository checks.

## Verification

- Regular, bold, italic, and bold italic Vietnamese text compile from the two
  variable EB Garamond files.
- Vietnamese diacritics render without missing glyphs, clipping, or collisions.
- Focused PDF-export tests, Rust formatting, notice generation, JavaScript
  syntax, and whitespace validation pass.
