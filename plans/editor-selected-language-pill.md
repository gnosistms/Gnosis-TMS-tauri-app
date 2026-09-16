# Selected language indicator

## Plan

1. Render a selected-language class from the existing per-language selection state.
2. Keep mounted language indicators synchronized through the row connection controller, including sidebar-only renders and deselection.
3. Style the selected language name as a small orange pill without shifting layout or changing conflict text colors.
4. Verify language/row switching, focus in the sidebar, and deselection in browser tests; run the relevant checks.

## Validation

- Implemented the orange pill using existing `isActive` language state and the row connection controller. Selection styling persists independently of keyboard focus and preserves conflict text colors.
- Five browser tests pass in installed Chrome, including macOS/Windows UI modes, sidebar focus, language/row changes, deselection, and existing row-connection checks with 6 and 200 rows. Windows UI mode is simulated, not a native Windows run.
- `npm test` passes (2,180 app tests and 23 workflow tests), using bundled Git and local-server permission for workflow tests.
- ESLint has no errors; the existing unused `editorReplace` argument warning remains. The unused-code audit is identical to the preceding sidebar change's results. Git whitespace checks pass.
