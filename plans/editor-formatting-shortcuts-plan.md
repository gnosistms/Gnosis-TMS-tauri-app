# Editor formatting keyboard shortcuts

## Changes
1. Handle Command+B/I/U on macOS and Ctrl+B/I/U on Windows/Linux in the existing
   keyboard shortcut module, only from an editable editor row textarea.
2. Activate the matching bold, italic, or underline button in that textarea's
   language cluster. Reuse the button's exact action path and selection behavior;
   hidden/unavailable controls
   (SRT, custom HTML, read-only rows) do not gain formatting shortcuts.
3. Verify platform modifiers, composition/repeat/modal guards, selected text and
   cursor-word toggling, focus preservation, and secondary editor fields.

## Validation — complete
- Full frontend and workflow suites pass. All 27 focused keyboard/event tests pass,
  including platform modifiers, blocked combinations, composition/repeat, modal,
  read-only, disabled, missing-button, and non-editor guards.
- Three Chrome regressions pass: Mac and Windows fixture modes toggle bold,
  italic, and underline on selections and cursor words, interoperate with the
  buttons, preserve focus, and target footnotes without changing body text.
  SRT/custom HTML shortcuts leave content unchanged.
- Changed keyboard modules pass ESLint; scoped whitespace checks pass.
- Production build passes with the existing bundle-size warning.
- Platform fixture checks ran on macOS; no native Windows session was used.

## PR integration
- Package only the shortcut module, its unit/browser regressions, and this plan
  in a clean worktree based on current main. Preserve the original dirty checkout.
- Explicitly guard SRT chapters in the shortcut module; current main still has
  SRT formatting buttons, so button absence alone cannot protect the isolated PR.
- Revalidate against main, create a focused PR, and merge after required checks.
