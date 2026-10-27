# Own comments should stay read

## Investigation

Comment saves already return the new row comment revision, and the active-row
success callback marks that revision read. However, moving to another row or
chapter before saving finishes skips that callback's read receipt entirely.
Chapter reloads also preserve a captured earlier seen-revision map over freshly
loaded receipts, which can undo the read state of a newly saved comment.

## Implementation and validation

1. Reproduce the save/read behavior, including changing selection during a
   delayed save and a chapter reload overlapping the new receipt. Verify the
   backend response's revision contract before changing frontend state.
2. Persist a successful own-comment receipt for the originating login/chapter,
   independently of the current selection. Update the correct visible row
   without replacing another row's comments or drafts; preserve monotonic seen
   revisions through reloads.
3. Add focused regression coverage for successful saves, failures, navigation,
   account scoping, and genuinely new comments remaining unread. Run required
   frontend tests, unused-export audit, lint, and relevant browser tests.

Keep the existing glossary changes and review finding outside this task.

## Result

- Successful saves persist the originating author's receipt before checking the
  current selection. Same-chapter saves update the affected row summary and read
  map while preserving another row's comments/draft. Other accounts/chapters do
  not receive visible state updates.
- Account identity is captured when queuing the write, with the signed-in
  author as a fallback before storage-login initialization.
- Seen revisions are merged by maximum through persistence and chapter loads;
  restored receipts are also retained when opening a different chapter.
- Regression tests reproduced skipped receipts after row/chapter/account
  changes. Coverage includes successful/failed saves, later unread revisions,
  storage-login initialization, reload races, and receipt restoration.
- Verification: backend comment revision tests 4/4; browser comment tests 3/3;
  full application tests 3,044/3,044 at the full-suite checkpoint, followed by a
  passing focused run including the additional chapter-restoration regression.
  All 25 workflow checks passed across the sandbox run and the launcher rerun
  with server/process access. Changed-file ESLint, whitespace checks, and build
  passed (existing large-chunk warning).
- Unused-code audit reports unrelated script/test and export findings; none of
  the changed comment modules or the new merge helper are listed. No unrelated
  files were cleaned up. Native app interaction was not manually exercised.

## PR isolation on current main

1. Isolate this fix and its regressions on current `origin/main`, preserving
   unrelated changes in the original development checkout.
2. Run frontend tests, browser regressions, lint, build, and the unused-code audit.
3. Publish a focused PR targeting `main` with the verified results.

Isolation validation (2026-10-27, main `492b2bab`): all 3,206 application
unit/screen tests and 25 workflow tests passed. All five comment browser
regressions passed in installed Chrome against this checkout on port 1437.
Changed-file ESLint, production build, and whitespace checks passed. The
unused-code audit output is identical to main (existing findings retained).
