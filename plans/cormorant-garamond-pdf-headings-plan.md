# Cormorant Garamond PDF Headings Plan

## Goal

Use Cormorant Garamond Semibold (600) for PDF chapter and section headings while
retaining EB Garamond for Latin-script body text and fallback.

## Implementation

1. Add the official pinned Cormorant Garamond Roman variable TTF to the
   Latin-heading on-demand font pack with byte-size and SHA-256 validation.
2. Add a Typst heading show-rule that applies Cormorant Garamond weight 600
   without changing heading levels, numbering behavior, content, or spacing.
3. Update font selection and generated-source tests, first-use download totals,
   the PDF design plan, and generated SIL OFL third-party notices.
4. Compile the app's Vietnamese PDF smoke document using only the configured
   fonts, then render and inspect a representative heading page.

## Verification

- Vietnamese heading glyphs render in Cormorant Garamond at weight 600.
- EB Garamond remains the body family. CJK and Arabic-script exports retain
  their regional heading typography and do not download Cormorant Garamond.
- Focused Rust tests, Rust formatting, notice generation, JavaScript syntax,
  and whitespace validation pass.
