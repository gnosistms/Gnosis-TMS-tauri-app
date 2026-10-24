# Quote and attribution editor refinement

Quote-body formatting in step 1 was superseded by the user clarification in
[quote-attribution-formatting-correction.md](quote-attribution-formatting-correction.md).
Only attribution receives the smaller, right-aligned formatting.

## Changes
1. Right-align Quote body text at 90% of normal body size in the editor and the
   locally formatted preview/exports. Keep the attribution at 90% of normal body
   size too, without compounding relative font reductions. WordPress and Vellum
   retain their native quote/attribution semantics and own the presentation.
2. For an empty editable attribution, show only “Click here to enter attribution.”
   Clicking its native label focuses the textarea and reveals the placeholder
   “Enter attribution here.” Use CSS focus/placeholder state so typing never
   remounts the field, and its native undo stack remains intact.
3. Hide empty attribution completely for read-only rows and rendered output,
   including whitespace-only attribution. Verify click, keyboard focus, typing,
   clearing/blur, persistence, preview/export, and SRT behavior.

## Validation — complete
- Full frontend suite: 2,992 passed; workflow suite: 25 passed.
- Rust chapter editor suite: 325 passed, six existing opt-in tests ignored.
  After adding the blank-attribution export regression, all 51 export tests pass.
- Bundled Typst compiler smoke test passes with the smaller, right-aligned quote.
- Four Chrome browser regressions pass: row typography, attribution save/preview/
  style conversion, hidden SRT controls, and empty-prompt click/Tab/typing/undo/
  clearing/blur behavior. Placeholder text never enters saved content.
- Preview and editor screenshots inspected; quotation and source each use 90% of
  the normal body size. Empty attribution creates no citation or native DOCX
  attribution paragraph, including whitespace-only values.
- Production build and scoped whitespace checks pass.
- Windows editor scrolling was not exercised on this macOS host.
