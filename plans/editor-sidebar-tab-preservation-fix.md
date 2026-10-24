# Keep the selected editor sidebar tab when changing rows

## Plan
1. Trace row activation and explicit sidebar navigation, and reproduce the unwanted Review-to-AI-Assistant switch.
2. Remove automatic tab selection based on whether a field is empty. Preserve the selected tab for every ordinary row/language selection, retaining deliberate tab actions and existing availability rules.
3. Add browser coverage for Review, AI Assistant, History, and Comments across filled/empty fields, language changes, and clearing selection through search. Validate, include the fix in PR #371, and merge after final CI passes.

## Validation
- The row-activation helper forced AI Assistant for empty or whitespace-only destination text. Removed that obsolete content-based policy and reuse the selected-tab normalizer directly.
- The new Review browser regression fails before the change when selecting an empty field, then passes after it.
- Four new browser cases cover every tab, filled/empty/whitespace-only fields, language changes, search clearing selection, and deliberate navigation to a different tab. Comments continue loading for the selected row.
- All eight focused browser checks pass, including the existing Mac/Windows language-selection, no-selection sidebar, and live AI-review cases.
- All 2,991 frontend tests and 25 workflow tests pass. The former unit test requiring the superseded auto-switch behavior was removed; existing tab-normalization tests remain.
- Production build, scoped lint, and whitespace checks pass.

## CI follow-up
- Windows passed all 13 new PR regressions but failed an existing deleted-row preparation assertion that required an off-screen row to leave the DOM.
- Reproduced the same failure on unchanged main. Geometry confirms the selected row is tens of thousands of pixels above the viewport while remaining mounted; the connection notice is correct.
- Change that preparation assertion to require the row to be outside the viewport. Keep the section-close and permanent-delete DOM-removal assertions, and the reveal/selection checks.
- Unchanged main fails 9 of 10 repeated runs at the same assertion; the corrected test passes all 10 repetitions.
