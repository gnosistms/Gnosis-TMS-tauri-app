# Case-sensitive project search

Add the editor's aA toggle to the Projects search field, off by default.

1. Wire the toggle into project search state and requests, retaining the setting
   while editing or clearing the query and rejecting stale requests after toggles.
2. Apply case-sensitive literal matching to indexed plain text before the result
   cap, center snippets on matching text, and use the setting for highlighting and
   editor navigation. Keep existing ranked search behavior when disabled.
3. Verify backend matching and caps, frontend requests and state, highlighting,
   toolbar rendering, and editor handoff with focused tests; run the frontend suite
   and unused-export audit.

Status: complete.

Validation:
- All 2,248 frontend unit tests passed; all 23 workflow tests passed after allowing
  localhost access for the dev launcher tests.
- Project search Rust tests: 27 passed, 1 existing calibration test ignored.
- The browser toggle test passed, including action dispatch and query edits.
- ESLint passed for changed frontend modules and tests; diff whitespace check passed.
- Unused-code audit reported only unrelated existing files, exports, and imports.
