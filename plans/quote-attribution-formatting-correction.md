# Apply smaller right-aligned formatting only to attribution

## Changes
1. Restore quote bodies to their normal font size and left alignment in the
   editor, preview, and locally formatted HTML, PDF, DOCX, and RTF exports. Keep
   their existing quote indentation and italics.
2. Keep attribution separately right-aligned and 90% of normal body size. HTML
   citations must use 90% directly now that their quote parent uses normal size.
   Preserve native WordPress/Vellum semantics and the empty-field behavior.
3. Update regression expectations to distinguish body formatting from attribution
   formatting. Verify both editor states, preview, exports, and existing filters.

## Validation — complete
- Full frontend suite: 2,994 passed; workflow suite: 25 passed.
- Rust chapter editor suite: 326 passed, six existing opt-in tests ignored.
  HTML, DOCX, RTF, and PDF source assertions distinguish quote bodies from sources.
- Bundled Typst compiler smoke test passes with a quote and attribution.
- Five Chrome browser regressions pass, including editor/preview font sizes and
  alignment, placeholder/undo behavior, style conversion, SRT, and style filters.
- Editor and preview screenshots visually confirm the separate formatting.
- Production build and scoped whitespace checks pass.
- Native Windows scrolling was not exercised on this macOS host.
