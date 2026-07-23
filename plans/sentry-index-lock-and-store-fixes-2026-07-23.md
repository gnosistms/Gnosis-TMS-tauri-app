# Fix plan — Sentry index.lock race, persistent-store loss, overdue noise

Source review: `plans/sentry-code-review-2026-07-23.md`. Three findings, implemented
together (small, independent commits).

## Finding 1 — serialize git-mutating content writes under `repo_sync_lock`

**Root cause:** the per-repo mutex `repo_sync_lock` (`repo_sync_shared.rs:43`) is held by
sync entry points but NOT by project chapter/row content writes or by the team-metadata
repo, so a content write racing a background sync collides on `.git/index.lock`
(Sentry JAVASCRIPT-1H and JAVASCRIPT-1T).

Deadlock check (done before implementing):
- `git_commit.rs` does not acquire `repo_sync_lock` — safe to hold it around commits.
- Sync (`project_repo_sync.rs`) never calls the content-write helpers — no nesting.
- `write_row_files_and_commit_with_removals` delegates to `write_row_files_and_commit`
  only in the empty-removals branch (before its own lock), so no double-acquire.
- Metadata: `pull_local_metadata_repo` is called only from the sync command; the mutation
  helpers `upsert_local_record` / `delete_local_record` are called only from mutation
  commands. Pull and mutate never nest, so no reentrant acquire.

Choke points (each acquires `repo_sync_lock(repo_path)` for the duration):
- `project_import/chapter_editor/shared.rs` — `write_row_files_and_commit` and
  `write_row_files_and_commit_with_removals` (covers every chapter/row/workflow-status
  write, since all of them funnel through these two).
- `team_metadata_local/repo.rs` — `pull_local_metadata_repo` (metadata sync).
- `team_metadata_local/mutations.rs` — `upsert_local_record`, `delete_local_record`
  (metadata mutations).

## Finding 1b — best-effort stale `index.lock` cleanup

Add narrow stale-lock removal to `abort_in_progress_git_operations`
(`repo_sync_shared.rs:79`): remove `.git/index.lock` if present. This runs only from
recovery paths (not during a live git op), so it will not delete a lock held by a
concurrent subprocess of ours — those are now serialized by Finding 1.

## Finding 2 — persistent-store re-flush after handle reload

`persistent-store.js` `reloadStoreHandle`: after re-acquiring the fresh handle, re-persist
the authoritative `memoryState` so the write that triggered the stale-id (and any writes
during the reload window) reach the store file instead of being lost on next boot
(Sentry JAVASCRIPT-1Q). Secondary late-rejection race is left as-is (self-heals; no data
loss once re-flush lands).

## Finding 3 — raise the `repoMaintenance` overdue threshold

`repo-write-queue.js` `OVERDUE_THRESHOLDS_MS.repoMaintenance`: 120s → 600s so the
telemetry fires only when a maintenance op is genuinely stuck, not merely large
(Sentry JAVASCRIPT-5 noise). No functional change.
