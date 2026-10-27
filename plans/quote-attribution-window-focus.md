# Keep attribution prompts exclusive across window activation

An empty quote attribution uses a click prompt and a native textarea placeholder.
Their visibility currently depends on `:focus-within` inside `:has()` selectors;
the reported macOS window-switch sequence leaves both messages painted.

1. Use a single DOM editing marker for the attribution wrapper. Set it on field
   focus and clear it after focus truly leaves that field. Preserve it when the
   window loses focus while the textarea remains the document's active element.
2. Drive the label, click prompt and collapsed textarea from that same marker,
   preserving keyboard access, text/selection, undo and the smaller italic prompt.
3. Exercise empty and populated attributions through window switching, true blur,
   and existing attribution save/undo behavior. Do not change saved row data.

Validation: all three attribution browser checks pass in Chrome, including
window deactivation/reactivation, real field blur, typing, undo and saving.
All 44 focused event/row-render unit tests pass. Whitespace checks pass and
ESLint has no errors (the existing unused `activeEditorControlRowId` warning
is unchanged). The reported native macOS paint glitch was not reproduced in
headless Chrome; the regression verifies the shared editing state across the
window-switch sequence without relying on focus pseudoclass repainting.

## PR isolation on current main

1. Isolate this fix and its regressions on current `origin/main`, preserving
   unrelated changes in the original development checkout.
2. Run frontend tests, browser regressions, lint, build, and the unused-code audit.
3. Publish a focused PR targeting `main` with the verified results.

Isolation validation (2026-10-27, main `492b2bab`): all 3,197 application
unit/screen tests and 25 workflow tests passed. All three attribution browser
checks passed in installed Chrome on port 1437. Retained main's stronger
existing prompt-persistence assertion and reran its browser check successfully.
The build and whitespace checks passed; ESLint has no errors and retains the
existing unused-function warning. The unused-code audit output matches main.
