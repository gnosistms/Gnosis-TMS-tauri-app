# Keep AI review visible while editing

## Intent
Keep completed AI review text visible after edits, using the current editor text
as the diff baseline. Replace the stale warning with the caption
“Compared with the current text in the editor.” in the existing history metadata style.

## Steps
1. Update the review pane to render stale suggestions (or the reviewed snapshot
   for a clean review) using the existing history diff renderer. Preserve the
   existing stale-review Apply guard and availability of fresh review actions.
2. Cover repeated edits, clean reviews, footnotes/captions, and selection isolation
   with sidebar regression tests.
3. Run the relevant tests and repository verification checks.

## Validation
- Completed: retained stale suggestions and clean-review snapshots, with current
  text/footnote/caption diffs and the requested caption in history metadata style.
- Frontend suite: 2,251 tests passed; final sidebar rerun: 40 passed.
- Workflow suite: 23 passed after rerunning outside the sandbox (local test
  server startup was blocked in the sandbox).
- Browser regression passed: successive live edits update the review diff while
  preserving input focus and fresh-review actions. Screenshot inspected for
  matching caption style and right alignment.
- Changed JS files pass ESLint; `git diff --check` passes.
- Unused-code audit reports existing findings outside this change (three unused
  scripts, five unresolved imports in app-update.spec.js, and the unused
  ensureEditorFootnoteEntry export). No new findings.
- Native Windows behavior has not been exercised; no scroll/render scheduling
  changes were needed.
