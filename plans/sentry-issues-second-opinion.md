# Sentry Issues Triage - Second Opinion Handoff

## Context

Sentry is showing several JavaScript command-failure issues from the desktop app. The screenshot showed these issue titles:

1. `sync_local_team_metadata_repo: git pull --ff-only failed: fatal: Cannot fast-forward to multiple branches.`
2. `purge_local_gtms_glossary_repo: The local glossary repo is not available yet.`
3. `repo_write_overdue: repoMaintenance`
4. `sync_gtms_project_editor_repo: Could not reach the GitHub App broker: error sending request for url (...)`
5. `sync_gtms_project_editor_repo: git fetch origin main failed: fatal: unable to access 'https://github.com/...`

## Initial Read

Only the first item looks like a likely product bug. The others mostly look like expected operational/local-state failures being reported too aggressively by the frontend's global `invoke()` telemetry wrapper.

Relevant telemetry path:

- `src-ui/app/runtime.js` wraps Tauri `invoke()`.
- On any command failure, except `AUTH_REQUIRED`, it calls `reportCommandFailure(command, error)`.
- `src-ui/app/telemetry.js` sends this as a Sentry message tagged with `source=command-failure` and `command=<command>`.
- This means routine background sync/network failures can become Sentry Issues even when callers handle them as expected in UI state.

## Issue-by-Issue Notes

### 1. Team metadata pull cannot fast-forward to multiple branches

Likely real backend sync bug.

Relevant code:

- `src-tauri/src/team_metadata_local.rs`
  - `sync_local_team_metadata_repo(...)`
  - calls `pull_local_metadata_repo(...)`
- `src-tauri/src/team_metadata_local/repo.rs`
  - `pull_local_metadata_repo(...)`
  - currently runs `git pull --ff-only`

Why this looks actionable:

- Plain `git pull --ff-only` relies on local branch tracking configuration.
- The error `Cannot fast-forward to multiple branches` suggests the local branch has multiple upstream merge refs or ambiguous pull configuration.
- This should be deterministic and repairable by pulling the intended branch explicitly.

Possible fix direction:

- Replace plain `git pull --ff-only` with explicit branch pull, e.g. `git pull --ff-only origin <current_branch>`.
- Or use `git fetch origin <current_branch>` followed by `git merge --ff-only FETCH_HEAD`.
- Also consider repairing local branch upstream config if multiple `branch.<name>.merge` entries exist.

### 2. Purge local glossary repo says repo is not available yet

This should probably be idempotent success.

Relevant code:

- `src-tauri/src/glossary_storage/mod.rs`
  - `purge_local_gtms_glossary_repo(...)`
  - calls `purge_local_gtms_glossary_repo_sync(...)`
  - calls shared `purge_repo(...)`
- `src-tauri/src/repo_resource_storage.rs`
  - `purge_repo(...)`
  - first calls `resolve_git_repo_path(...)`
  - `resolve_git_repo_path(...)` returns `"The local glossary repo is not available yet."` before `purge_repo()` can check `repo_path.exists()`

Why this looks actionable:

- For purge/delete/rollback, "local repo is absent" is already the desired end state.
- Current behavior turns an absent checkout into a failed command, which then becomes Sentry noise.

Possible fix direction:

- Make `purge_repo(...)` tolerate missing local resource repos.
- Prefer resolving a deterministic repo path from `repo_name` when available, then removing if it exists.
- If no path can be resolved because the repo never existed, return `Ok(())`.

### 3. `repo_write_overdue: repoMaintenance`

Probably a warning to watch, not an immediate bug by itself.

Relevant code:

- `src-ui/app/repo-write-queue.js`
  - `REPO_WRITE_OVERDUE_THRESHOLDS.repoMaintenance = 120_000`
  - overdue timer reports `reportRepoWriteOverdue({ operation: "repo_write_overdue", reason: operation.operationType || operation.kind })`

Notes:

- One event means a repo maintenance operation exceeded 120 seconds.
- If this repeats, add more metadata/tags for scope, operation id, and queue size to distinguish slow git/network from a stuck queue.

### 4. Project editor sync could not reach GitHub App broker

Likely expected operational/network failure being over-reported.

Relevant code:

- `src-tauri/src/broker.rs`
  - `broker_send(...)`
  - maps request failure to `Could not reach the GitHub App broker: {e}`
- `src-ui/app/editor-background-sync.js`
  - catches sync errors and calls `classifySyncError(error)`
- `src-ui/app/sync-error.js`
  - classifies broker reachability errors as `connection_unavailable`

Why this is probably not a defect:

- Background sync can fail while offline, on broker outage, or during transient network failures.
- The UI path already treats these as sync errors.
- Sentry sees them because `runtime.js` reports failed commands globally before callers classify/handle them.

Possible fix direction:

- Suppress `reportCommandFailure` for expected `connection_unavailable` sync commands.
- Candidate commands: `sync_gtms_project_editor_repo`, `sync_gtms_glossary_editor_repo`, `sync_gtms_qa_list_editor_repo`, top-level repo sync commands, possibly team metadata sync.

### 5. Project editor sync git fetch unable to access GitHub

Same category as #4.

Relevant code:

- `src-tauri/src/project_repo_sync.rs`
  - `sync_gtms_project_editor_repo_sync(...)`
  - calls git transport operations in background sync
- `src-ui/app/sync-error.js`
  - classifies git/GitHub/network failures as `connection_unavailable`

Why this is probably not a defect:

- `fatal: unable to access 'https://github.com/...` is usually network/GitHub/DNS/auth transport.
- If not auth-related, it is expected to happen occasionally in a local-first desktop app.
- Should show in UI sync state, not necessarily create Sentry issues.

## Recommended Priority

1. Fix team metadata pull branch ambiguity.
2. Make glossary/QA/project local purge idempotent when the local repo is already missing.
3. Add telemetry filtering so expected sync/network failures do not create Sentry Issues.
4. Watch `repo_write_overdue: repoMaintenance`; only investigate deeply if it repeats or correlates with stuck UI state.

## Specific Question For Review

Does this diagnosis line up with the code paths, especially:

- Is `git pull --ff-only origin <current_branch>` enough for team metadata sync, or should we also repair branch upstream config?
- Should purge commands be idempotent across glossary, QA list, and project local repos?
- Should telemetry filtering live in `runtime.js` using `classifySyncError`, or should callers explicitly mark expected command failures as handled?
