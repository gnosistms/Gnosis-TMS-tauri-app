# Preserve undo after editor paste

1. Reproduce native undo loss when a large paste changes the virtual row range.
2. Keep the focused row connected during virtual range updates so its textarea retains native edit history; continue updating surrounding rows and spacers.
3. Verify paste undo/redo, focused row patching, and virtualization regressions with browser tests and relevant unit checks.
4. Verify the existing row-patch undo regression with native keyboard shortcuts in WebKit as well as Chrome.

Scope: editor virtual list rendering and its browser regression coverage. Native Undo/Redo menu items are already registered; ordinary textarea paste uses the browser's default input path.

Implemented: virtual range rendering preserves the focused row in place when it remains in the new range, rebuilding its siblings without detaching the textarea. Rows leaving the range still unmount normally.

Verification:
- The new browser regression failed before the fix: native undo left the inserted multiline text unchanged after the visible range contracted.
- Seven focused browser regressions pass in Chrome, including native undo/redo, row patching, height changes, filtered typing, and scrolling after structural edits.
- The same seven regressions pass in WebKit. The existing row-patch test now changes text style instead of marking the row stale: stale rows intentionally cancel beforeinput, including historyUndo in WebKit. This corrects the test fixture without changing the stale-row editing guard or row-patching implementation.
- All 2,170 frontend unit tests pass. All 23 workflow tests pass with bundled Git and process access (system Git requires Xcode license acceptance on this machine).
- The 16 focused editor unit tests and ESLint pass after the final guard adjustment.
- Unused-code audit reports existing findings in unrelated files; this change adds no exports or imports.
- Actual Windows execution remains unverified on this macOS host.
