# Project creation readiness and operation errors

## Scope

Make newly created local projects usable before background synchronization finishes,
without losing edits during their first sync. Keep project deletion failures local
to the operation rather than replacing the projects list. Retain TanStack Query
and existing repository write serialization; do not introduce another state layer.

## Plan

1. Record the local initialization commit and safely attach subsequent local work
   to the remote history on first sync. Verify with temporary Git repositories,
   including failure/retry and conflicting work.
2. Give local file listings an explicit readiness result. Preserve ready empty
   projects through discovery and sync, while keeping missing repositories gated.
3. Publish successful creation through the query layer and release creation before
   the background refresh completes. Preserve team scoping and write intents.
4. Present deletion failures as operation notices while retaining the list.
5. Add regressions for creation during refresh, empty project readiness, failed
   deletion, and first-sync preservation. Run relevant Rust/frontend tests, then
   required frontend checks and inspect the final diff.

## Review follow-up

1. Preserve the bootstrap layout metadata in the remote-based rebase base, without
   changing the working tree or index before replaying local commits. Expand Git
   fixtures to the real broker/local bootstrap and migration metadata sequence.
2. Align the existing local branch with the remote default branch without forcing
   over another local branch; cover non-main branches and retry/conflict recovery.
3. Separate stalled UI feedback from queue ownership: keep polling until the native
   job finishes, including after discovery cancellation. Cover both stall thresholds
   and writes queued behind a slow native sync.
4. Run focused regression tests, required frontend checks, and inspect the diff.

## Initial implementation validation

Completed.

- Creation publishes a ready, empty project through the query layer after local
  initialization and required metadata writes, then starts discovery in the
  background. Creation no longer uses the page-wide refresh-after-write gate.
- Local listings explicitly distinguish an available empty checkout from a
  missing checkout. Discovery retains this readiness independently of sync.
- First sync replays commits after the recorded bootstrap onto remote history.
  Older unmarked projects replay their entire history; conflicts abort back to
  the original local state. Sync only settles after the normal push succeeds.
- Query cancellation prevents obsolete discovery publications and missing-repo
  finalization. Creation cancels discovery before changing metadata and refreshes
  the installation listing afterward. Native sync polling retains the existing
  repository write queue when discovery is canceled, suppressing stale UI updates.
- Delete failures use operation notices and retain the existing list/rollback.

Checks:

- `npm test`: 2,199 frontend tests and 23 workflow tests passed. Workflow tests
  were run with local-server access because the sandbox blocks localhost binds.
- Focused final regression run: 118 tests passed, including cancellation before
  creation, preservation through discovery, team switching, and failed deletion.
- Rust project sync tests: 24 passed; local sync-state tests: 5 passed.
- Projects-page Playwright suite: 14 passed, including viewport preservation.
- Rust formatting and `git diff --check`: passed.
- ESLint: no errors; unchanged unused-import/function warnings remain.
- Unused-code audit: only findings in unchanged scripts, editor-footnotes, and
  app-update browser tests; no new findings from this change.

Native first-sync tests use temporary local Git remotes; frontend operation tests
mock Tauri IPC. No live GitHub project was created or deleted for verification.

## Review follow-up validation

Completed the three review fixes:

- First sync retains the initialization version of `.gtms/repo.json` in a commit
  based on the remote before replaying migrations or user work. A temporary Git
  index leaves the original checkout recoverable on failure. Existing remote
  layout metadata remains authoritative.
- The local branch follows the remote default without forcing over an existing
  local branch. Tests cover `main` and `trunk`, empty and imported projects,
  migration metadata, push/retry, and conflict restoration.
- Polling decorates stalled progress for the UI while retaining the native
  snapshot and write-queue ownership until completion. Tests cover no-progress
  and maximum-duration thresholds, cancellation, and a waiting import.

Checks: 27 Rust project sync tests, 2,202 frontend tests, and 23 workflow tests
passed. The workflow suite was rerun with localhost access after the sandbox
blocked its test server. Focused ESLint, Rust formatting, and whitespace checks
passed. The unused-code audit retains only the previously recorded unrelated
findings.

Verification uses temporary local Git repositories and mocked Tauri responses;
the packaged app and live GitHub were not exercised during this follow-up.
