# Unreview all blocked by deleted rows

## Problem

The chapter-wide queued write guard rejects every row whose lifecycle is deleted.
The editor retains soft-deleted rows, so a clean chapter containing one cannot run
Unreview all. The backend bulk marker command already handles stored chapter rows.

## Plan

1. Check the backend marker update path and reproduce the frontend rejection with
   a clean soft-deleted row in an otherwise editable chapter.
2. Allow settled deleted rows in chapter-wide readiness checks, retaining stale,
   conflict, remote deletion, pending write, and structural refresh guards. Keep
   explicit row writes to deleted rows blocked.
3. Run regression tests, the frontend suite, and the unused export audit.

## Validation

- Reproduced the failure before the fix: the bulk marker command was never invoked
  when a fresh, soft-deleted row was present. The regression passes after the fix.
- All 2,103 frontend tests passed, including 39 focused write-guard/review tests.
- Both Rust field-marker tests passed.
- All 17 workflow tests passed when rerun outside the sandbox. The initial sandbox
  run blocked the temporary localhost servers used by four dev-launcher tests.
- ESLint on the changed JS files and `git diff --check` passed.
- The unused export audit reports unrelated existing entries: three unused scripts,
  five absolute browser-test imports, and `ensureEditorFootnoteEntry`. No finding
  references the changed files; this fix adds no exports or dependencies.
- The installed desktop app and the user's chapter were not modified or exercised.

## Review follow-up: queued Clear translations

The shared guard relaxation also allowed Clear translations to erase a captured
row after an earlier queued deletion completed. Preserve the chapter-wide checks,
then validate the captured target IDs separately at execution time so deleted or
missing targets abort the batch. Add regressions for this queue ordering and for
successful clearing with unrelated, already-deleted rows, then run the frontend
tests and focused lint checks.

Completed: Clear translations now validates its captured target IDs immediately
before invoking the batch command, after the existing chapter-wide checks. The
queue-ordering regression failed before the fix and passes afterward; unrelated
settled deletions still permit clearing active rows. All 2,105 frontend tests pass.
Focused ESLint completed with no errors and five existing warnings on unchanged
lines in editor-persistence-flow.js. `git diff --check` passed.

## PR validation on current main

The isolated PR branch based on main at `42c8c893` passes `npm test`: 2,105
frontend tests and 13 workflow tests. Focused ESLint has no errors; the same five
existing warnings remain. The unused-code audit reports two existing benchmark
scripts, five browser-test imports, and one unrelated export.
