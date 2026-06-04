# Code Review - Batch 5: Project Sync + Migrations
<!-- vt.idd:local-review:batch-5 -->

**Date**: 2026-06-03
**Status**: **Complete.** Two major findings remain open.
**Scope**: per-domain project sync state machine + repo layout migrations
**Files**:

| File | Lines | Reviewed? |
|---|---:|---|
| `project_repo_sync.rs` | 2,181 | ✅ done |
| `repo_migrations.rs` | 1,114 | ✅ done |
| `team_repo_migrations.rs` | 272 | ✅ done |
| **Total** | **~3,567** | |

**Review focus (per Rust Review Strategy)**: `project_repo_sync.rs` holds the most complex
sync state machine. Review for correctness of push/pull/rebase/conflict transitions.
Migrations are additive-only; verify no existing migration step is modified or reordered,
and that re-running a migration is idempotent.

---

## Preliminary per-batch checks

### Standard V sweep (synchronous commands doing I/O)

All `#[tauri::command]` functions in this batch are `async`, and the blocking git/filesystem
work is run through `tauri::async_runtime::spawn_blocking`:

- `reconcile_project_repo_sync_states`
- `list_project_repo_sync_states`
- `sync_gtms_project_editor_repo`
- `overwrite_conflicted_gtms_project_repos`
- `discard_old_layout_gtms_project_repos`
- `list_pending_team_repo_layout_migrations`

Result: ✅ no remaining non-async Tauri command in this batch performs network, git, or
large filesystem I/O on the IPC thread.

### Swallowed / non-fatal error pass

Reviewed `.ok()`, ignored git results, and best-effort fallbacks in the batch.

- Benign: cache snapshot mutex failures are limited to the in-memory project sync cache.
- Benign: forced recovery paths intentionally ignore pre-reset cleanup failures before
  performing explicit checkout/reset/clean recovery.
- Watch item, not a finding: `inspect_project_repo_state` treats an imported-conflict journal
  read failure as `false`, but the actual sync path calls `repo_has_imported_editor_conflicts`
  with `?` and will surface the error before syncing.

---

## Findings

### M1 - Destructive project recovery commands do not enforce a backend write-access gate

**Severity**: Major
**File**: `src-tauri/src/project_repo_sync.rs`
**Lines**: `1497-1521`, `1531-1572`, `1582-1612`

`overwrite_conflicted_gtms_project_repos_sync` and `discard_old_layout_gtms_project_repos_sync`
can reset and clean local project repos, then mark them synced. The destructive work ultimately
runs through `overwrite_project_repo_with_remote`, which performs `reset --hard`, `clean -fd`,
`checkout -B`, another `reset --hard`, and another `clean -fd`.

Those backend commands only load a Git transport token and do repo setup. They do not call a
backend write-access guard such as `ensure_repo_allows_writes` or
`ensure_installation_allows_chapter_writes` before making the destructive local changes. The
frontend queues these actions, but frontend gating is not a security or integrity boundary. A
direct Tauri command invocation should not be able to discard local project work unless the
backend has verified the signed-in user can write project content for that installation/repo.

**Recommended fix**: Add backend access checks before the destructive per-repo operation. Prefer
`ensure_repo_allows_writes(app, &repo_path)` after resolving each repo path, or an installation
level chapter-write guard before the loop plus repo-path validation where available. Add tests
covering permission denial for both overwrite-conflict and old-layout discard flows.

### M2 - First-sync attach path can discard committed local project work without a backup branch

**Severity**: Major
**File**: `src-tauri/src/project_repo_sync.rs`
**Lines**: `1058-1124`, `1617-1635`
**Related**: `src-tauri/src/project_import/chapter_editor/mod.rs:1161-1169`

New local project repos are initialized with `has_ever_synced: false`. During project sync, if
the remote has a default-branch head and the local sync state says the repo has never synced,
`sync_project_repo` calls `attach_unsynced_local_project_repo_to_remote`.

That helper fetches the remote branch and then runs:

```text
git checkout -B <branch> origin/<branch>
```

This moves the local branch to the remote tracking ref. The code backs up dirty/uncommitted
work before this branch, but it does not preserve committed local work when the local head is
not equal to the remote head. By contrast, the rebase recovery path explicitly creates a backup
branch when local and remote heads differ before resetting to remote. This first-sync attach
path should have the same protection, or should refuse to continue and surface a conflict.

This can happen if a locally initialized project has committed local project/editor changes and
the remote repo also has a branch head before the first successful local sync. The result is a
clean "up to date" status after the local branch has been moved to remote, with no backup branch
for the local commits.

**Recommended fix**: Before `checkout -B` in `attach_unsynced_local_project_repo_to_remote`,
compare `HEAD` with `origin/<branch>`. If they differ, either:

- create a backup branch with the same convention used by
  `recover_project_rebase_without_unmerged_files`, then report that recovery occurred; or
- return an out-of-sync/conflict status and require an explicit user decision.

Add a regression test with a never-synced local repo that has a local commit and a remote branch
head, asserting that the local commit is either preserved on a backup branch or the operation is
blocked.

---

## `project_repo_sync.rs` review notes

- Normal project sync checks imported editor conflicts before pulling/pushing; actual sync uses
  fallible conflict-journal reads, so unresolved imported conflicts block GitHub sync.
- The semantic conflict path resolves row/chapter conflicts into imported editor conflict
  records, persists them, and returns a blocked sync status until the editor resolves them.
- The rebase recovery path creates a backup branch when committed local `HEAD` differs from
  remote before force-adopting remote. This is the right model for destructive recovery and is
  covered by `recover_project_rebase_without_unmerged_files_resets_visible_branch_and_keeps_backup`.
- App-version forward-compat is checked before adopting remote project changes through
  `enforce_remote_project_app_version`.
- Conflict-overwrite and old-layout discard are explicit user-confirmed recovery paths, but M1
  still applies because backend permission checks must not rely on UI gating.

---

## `repo_migrations.rs` review notes

- Migration ordering is additive: `ordered_repo_migrations()` currently returns only
  `MIGRATION_0810`, and `is_migration_applied` prevents reruns.
- Dirty worktrees are blocked before local layout migration by
  `ensure_clean_repo_for_layout_migration`.
- The remote-already-migrated path returns the sentinel
  `REMOTE_MIGRATED_LOCAL_OLD_LAYOUT_CHANGES` when local old-layout changes would be overwritten.
  Actual discard is routed through the explicit old-layout discard command.
- Metadata writes use the shared repo layout/local sync-state writers that were made atomic in
  Batch 4 follow-up work.
- Existing tests cover clean migration, idempotency, dirty-worktree blocking, and the
  remote-migrated discard helpers.

No findings in `repo_migrations.rs`.

---

## `team_repo_migrations.rs` review notes

Read-only migration scan command (`list_pending_team_repo_layout_migrations`): for each
non-deleted project/glossary/QA candidate, resolves the local repo path and checks
`repo_requires_0810_migration`.

- Correctly async + `spawn_blocking`; maps the join error and propagates inner errors.
- Parity maintained: project, glossary, and QA candidates are scanned with identical logic.
- Deleted resources are excluded from migration candidacy (`deleted`, `softdeleted`, and
  `tombstone` across lifecycle/record/remote state).
- Read-only; no write atomicity concern.
- Unit coverage exists for the deleted-state filter.

No findings in `team_repo_migrations.rs`.

---

## Resolution status

| ID | Status | Target |
|---|---|---|
| M1 | Open | Add backend write-access gate to destructive project recovery commands. |
| M2 | Open | Preserve or block divergent committed local work in first-sync attach path. |
