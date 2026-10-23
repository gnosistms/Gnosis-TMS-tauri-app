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

### Isolated branch validation
- Based on main at `300a68a8858af175b3aa9cdab8b84fb7da720d0e`.
- All 2,990 frontend tests and 25 workflow tests pass.
- Three focused Chrome browser checks pass against the isolated branch, including
  SRT rejection while main's pre-existing formatting buttons are still present.
- Full JavaScript lint and production build pass. The unused-code audit reports
  existing findings (three scripts, five browser-path imports, seven exports);
  none involve the shortcut changes, which introduce no exported symbols.
