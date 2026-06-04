# Code Review — Batch 5: Project Sync + Migrations  🚧 IN PROGRESS
<!-- vt.idd:local-review:batch-5 -->

**Date**: 2026-06-03 (started)
**Status**: **In progress.** `team_repo_migrations.rs` reviewed; `project_repo_sync.rs`
(2,181 lines) and `repo_migrations.rs` (1,114 lines) still need the detailed pass — this
is the largest batch and was scaffolded ahead of a session boundary.
**Scope**: per-domain project sync state machine + repo layout migrations
**Files**:

| File | Lines | Reviewed? |
|---|---|---|
| `project_repo_sync.rs` | 2,181 | ⏳ pending (largest file in the codebase) |
| `repo_migrations.rs` | 1,114 | ⏳ pending |
| `team_repo_migrations.rs` | 272 | ✅ done |
| **Total** | **~3,567** | |

**Review focus (per Rust Review Strategy)**: `project_repo_sync.rs` holds the most complex
sync state machine — review for correctness of the push/pull/rebase/conflict transitions.
**Migrations are additive-only** — verify no existing migration step is modified or
reordered, and that re-running a migration is idempotent.

---

## Preliminary per-batch checks

### Standard V sweep (synchronous commands doing I/O)
All `#[tauri::command]` functions in this batch are **`async`** (`reconcile_project_repo_sync_states`,
`list_project_repo_sync_states`, `sync_gtms_project_editor_repo`,
`overwrite_conflicted_gtms_project_repos`, `discard_old_layout_gtms_project_repos`,
`list_pending_team_repo_layout_migrations`). ✅ at the signature level.
**Still to confirm in the detailed pass:** that each async command wraps its blocking git
work in `spawn_blocking` rather than awaiting nothing while blocking inline.
(`team_repo_migrations.rs` and the listing command do use `spawn_blocking` correctly.)

### Swallowed / non-fatal error pass
⏳ Pending for `project_repo_sync.rs` and `repo_migrations.rs`.

---

## Findings

_(To be filled in during the detailed pass of the two large files.)_

---

## `team_repo_migrations.rs` — ✅ reviewed (no findings)

Read-only migration **scan** command (`list_pending_team_repo_layout_migrations`): for each
non-deleted project/glossary/QA candidate, resolves the local repo path and checks
`repo_requires_0810_migration`. Notes:

- **Correctly async + `spawn_blocking`** (`:211`); maps the join error and propagates inner
  errors (`??`).
- **Parity maintained** — project, glossary, and QA candidates are scanned with identical
  logic, satisfying the glossary/QA parity rule.
- **Deleted resources are excluded** from migration candidacy (`is_deleted_state` covers
  `deleted`/`softdeleted`/`tombstone` across lifecycle/record/remote state). Good.
- Read-only — no writes, so no atomicity concern here.
- Good unit coverage of the deleted-state filter.
- _Minor (style, non-finding):_ the three candidate loops are near-identical and could share
  a generic helper; `match … { Some => …, None => {} }` could be `if let Some`. Cosmetic.

---

## TODO for the detailed pass (next session)

**`project_repo_sync.rs` (2,181 lines)** — the priority. Check:
- Sync state machine transitions (fetch → rebase → conflict → resolve/abort); confirm a
  failed pull leaves the worktree recoverable (ties to `abort_rebase_after_failed_pull`,
  Batch 4) and never silently discards local commits.
- Each async command uses `spawn_blocking` for git work; no blocking on the IPC thread.
- Conflict-overwrite / discard-old-layout commands gate on write access and don't destroy
  un-pushed local work without the documented backup branch.
- App-version forward-compat guard (`remote_ref_requires_newer_app`) is consulted before
  adopting remote changes.
- Swallowed-error pass over the file.

**`repo_migrations.rs` (1,114 lines)** — check:
- Migrations are **additive-only**: no existing step modified or reordered; `applied_migrations`
  recorded; re-running is idempotent.
- Dirty-worktree handling backs up before migrating (there are tests like
  `dirty_repo_blocks_layout_migration_before_backup` — confirm they hold).
- Atomic writes for any new metadata files (the `util::atomic_replace` discipline).
- Swallowed-error pass.

---

*Scaffolded ahead of a session boundary. Resume with the detailed pass of
`project_repo_sync.rs` then `repo_migrations.rs`.*
