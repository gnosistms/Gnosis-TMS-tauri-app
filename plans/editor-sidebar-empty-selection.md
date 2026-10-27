# Editor sidebar without a selected row

## Plan

1. Make tab navigation repaint immediately when there is no selected row, without starting row-specific loaders.
2. Use the compact Review empty-state layout for AI Assistant, History, and Comments; hide the assistant composer and full-height layout until a row is selected.
3. Verify actual tab clicks, empty-state size, and return to selected-row controls with a browser regression test; run relevant existing checks.

## Findings

- History delegates rendering to its loader, which returns without rendering when no field is selected.
- Comments already renders an empty state without a selected row; verify its real click path alongside the other tabs.
- AI Assistant renders its disabled composer and full-height class regardless of row selection.

## Validation

- Complete: no-selection tab changes repaint immediately, all panes use compact empty states, and the assistant's composer/full-height layout requires a selected row.
- Browser regression passes in installed Chrome: clicks all four tabs, checks matching compact heights, confirms no history/comment loads, and verifies the assistant composer returns after selecting a row.
- All 2,180 app tests and 23 workflow tests pass. Workflow tests needed bundled Git (system Git is blocked by the Xcode license) and permission to start local test servers.
- ESLint passes for changed source files; git diff whitespace checks pass.
- Unused-code audit still reports unrelated files, browser-test imports, and `ensureEditorFootnoteEntry`; none are introduced by these changes.
