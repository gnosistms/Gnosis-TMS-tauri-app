# Remove extra space around closed footnotes

## Investigation and changes
1. Reproduce the reported vertical gaps with a closed read-only footnote at
   multiple editor font sizes. Inspect the wrapper and text line boxes.
2. Remove renderer-generated whitespace from the footnote wrapper while retaining
   authored paragraph breaks, links, markers, and normal footnote typography.
3. Add geometry regressions for read-only and editable footnotes; validate before
   adding the correction as a separate commit to keyboard-shortcut PR #371.

## Validation
- Before the fix, the read-only 20px browser fixture fails with 61px of blank
  space above its content. The template's whitespace produces anonymous line boxes.
- The correction joins the wrapper/content tags and changes no footnote data or
  styling. All four geometry checks pass: read-only/editable at 20px and 28px,
  with multiple notes, authored line breaks, and a link.
- Visually inspected the corrected 28px read-only fixture.
- All 2,990 frontend tests and 25 workflow tests pass on the isolated PR branch.
  Seven focused browser checks pass including the formatting shortcuts; the four
  spacing cases also pass with visible screenshot fixtures.
- Production build, scoped lint (no errors), and whitespace checks pass.
- Include this as a separate correction commit in PR #371, then wait for the
  updated PR's required checks before merging.

## Empty-footnote marker click follow-up
1. Reproduce the Windows reopening failure with a marker click held across an animation frame.
2. Protect the closed-footnote mousedown from blurring and remounting the active row before its click handler can open the note, consistent with other editor controls.
3. Verify the held-click regression and repeat reopening, formatting, and focus tests before adding this correction to the PR.
- Holding the marker press for 150ms reproduces the Windows failure before the fix. With closed-footnote mousedown protected, all 10 repetitions pass.
- All 16 focused editor browser cases pass together, including the new features and existing footnote formatting/persistence interactions. All 2,991 frontend and 25 workflow tests, production build, scoped lint (existing warning only), and whitespace checks pass.
