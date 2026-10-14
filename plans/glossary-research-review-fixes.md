# Glossary research review fixes

1. Await confirmed glossary writes in report saves and retain persisted IDs; keep normal modal saves asynchronous.
2. Require every consistency retest sentence to receive all five valid choices.
3. Invalidate retests on entry edits and discard stale in-flight results.
4. Add regression tests and run frontend checks.

Completed all three fixes. Report saves wait for confirmed persistence and sync, use persisted IDs, and link only confirmed entries. Retests require complete valid answers and discard results after edits.

Validation: research and save regression suites pass; full frontend suite passed (2,520 tests before the final in-flight regression was added). Workflow suite passed (23 tests) with local server access. Unused-code audit output exactly matches HEAD. The four lint errors in touched engine files were verified to exist at HEAD. No native/backend code changed.

## Second review fixes

1. Keep edits made during a save pending; record only the submitted forms.
2. Clear both counts, aggregate, consistency, footnotes, and summary on proposal changes.
3. Share strict per-batch consistency coverage validation between the initial test and retests. Stop resumably on incomplete rounds or missing/invalid meaning verdicts.
4. Test save/edit races, changed-proposal resumes, failed/malformed rounds, and omitted verdicts; run required checks.

Second review fixes completed. Report writes retain newer edits as pending and record the submitted forms. Proposal changes invalidate every counting-dependent checkpoint. Initial tests and retests validate exact per-batch occurrence coverage and entry-specific choices; meaning verdicts must explicitly cover each flip once. Invalid results stop resumably without saving a consistency checkpoint. Explicit Skip remains supported.

Validation: 276 focused tests, all 2,535 frontend tests, and all 23 workflow tests passed. Workflow tests required local server access. Unused-code audit still exactly matches HEAD. Report/save files lint clean; the same four pre-existing lint errors remain in the engine and its tests. git diff --check passed. No native/provider calls were needed.

Commit preparation: corrected the four existing prefer-const errors in the modified engine files so staged-file ESLint can pass without bypassing the pre-commit hook.
