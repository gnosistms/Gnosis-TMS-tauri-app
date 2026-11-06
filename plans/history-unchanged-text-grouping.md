# History groups for unchanged text

1. Replace lossy marker-run compression and author-only grouping with consecutive
   groups whose text fields (main text, footnote, caption, attribution) match and
   whose underlying human author matches, independently of AI model metadata.
   Keep every revision, default groups to collapsed, and credit the newest entry.
2. Cover chained marker changes, human/AI transitions, author boundaries, every
   text field, expansion state, and collapsed/expanded sidebar rendering. Keep
   optimistic saves separate until their actual author is known. Formatting and
   image-only changes can group when all text fields remain unchanged.
3. Run focused tests, the frontend/workflow suite, JS lint, and the unused-export
   audit; record results. Existing Git history and save behavior stay intact.

Status: complete.

Validation:
- All 3,489 frontend tests pass, including grouping, identity, text boundaries,
  preservation of cancelled toggles, expansion reconciliation and sidebar tests.
- All 26 workflow tests pass. The initial sandboxed run could not start local
  test servers; rerunning the workflow suite with localhost access passed.
- Both new browser tests pass using real History expand/collapse actions, with
  latest-human and latest-AI credit. Three existing browser tests also pass for
  restore, undo replace and footnote history.
- JS lint and `git diff --check` pass.
- The unused-code audit reports repository-wide findings (345 unused files plus
  other findings); none names the changed history modules. No exported API or
  runtime imports were added by the grouping change.

## Expanded revision authors (2026-11-06)

1. Show each revision's own existing author label when a history group is expanded,
   including the AI model and controlling user for AI edits. Keep collapsed groups
   credited to the latest revision.
2. Extend the sidebar and browser regressions to verify each expanded entry's
   credit in both latest-human and latest-AI groups and verify collapsing hides
   those repeated labels.
3. Run focused history tests, the two browser cases, lint, and diff checks.

Completed: expanded entries now show their own author label above the revision.
AI entries include their model and controlling user; human entries show the user.
Collapsed groups retain only their latest-revision credit. All 89 focused history
and sidebar tests, both browser cases, lint, and `git diff --check` pass.

## Status-only revision content (2026-11-06)

1. Replace repeated history content with “Text unchanged.” when all text fields,
   media, and text style match the preceding comparison revision. Keep the
   author, status changes, time, and actions visible. A missing baseline must
   retain its text; collapsed groups continue comparing with the older visible
   group, while expanded entries compare individual revisions.
2. Render the message with the existing sans-serif UI font and add coverage for
   body, footnote, caption, attribution, media, and formatting changes.
3. Verify expanded/collapsed history behavior, message typography, and unchanged
   status marker controls in the browser, then run focused tests and lint.

Completed: status-only comparisons now show “Text unchanged.” in `--font-sans`.
All 102 focused tests and both browser cases pass, including typography and the
retained author/status controls. Lint and `git diff --check` pass.
