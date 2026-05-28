# Short Path Migration Orchestration Plan

## Purpose

Guide implementation of the short-path repo layout work across the seven stage plans. This file is the execution checklist: it defines order, checkpoints, test gates, and release criteria so we do not partially ship a repo-layout change.

Primary plan:

- [Short Path Layout And Repo Migration Pipeline Plan](short-path-layout-migration-plan.md)

Stage plans:

- [Stage 1: Foundation](short-path-stage-01-foundation.md)
- [Stage 2: Repo Identity And Local Path Resolution](short-path-stage-02-repo-identity.md)
- [Stage 3: New V2 Writes](short-path-stage-03-v2-new-writes.md)
- [Stage 4: Migration 0.8.10](short-path-stage-04-migration-0810.md)
- [Stage 5: Sync And Clone Integration](short-path-stage-05-sync-clone-integration.md)
- [Stage 6: Backup And Restore Integration](short-path-stage-06-backup-restore.md)
- [Stage 7: Regression, Cleanup, And Release Gate](short-path-stage-07-regression-release.md)

## Core Rule

Do not release after an intermediate stage. The app should release only after Stage 7 passes, because Stages 1-6 may temporarily contain compatibility paths or unfinished migration wiring.

## Implementation Order

1. Stage 1: Foundation
2. Stage 2: Repo Identity And Local Path Resolution
3. Stage 3: New V2 Writes
4. Stage 4: Migration 0.8.10
5. Stage 5: Sync And Clone Integration
6. Stage 6: Backup And Restore Integration
7. Stage 7: Regression, Cleanup, And Release Gate

The order matters. Stage 3 should not ship without Stage 4 and Stage 5, because new writes and legacy migration must agree on the final v2 layout. Stage 5 should not start before Stage 4 has isolated migration tests, because sync/clone bugs are harder to debug when the migration itself is still unproven.

## Checkpoint Strategy

Use checkpoints after each stage:

- Finish the stage implementation.
- Run the stage-specific tests listed in that stage file.
- Run targeted smoke checks when the stage touches user-facing flows.
- Do a code review focused on that stage's boundaries.
- Commit only when the stage is coherent and tests pass.

If a stage uncovers missing details in a later stage, update the later stage plan before continuing. Do not silently expand the current stage into unrelated future work.

## Stage Gates

### Gate 1: Foundation Complete

Required before Stage 2:

- `.gtms/repo.json` model exists and is tested.
- Migration registry can calculate pending migrations.
- Short folder and image filename allocators are tested.
- No production sync/clone flow depends on incomplete migration behavior.

Recommended tests:

- Rust unit tests for metadata parsing, migration resolution, and short-name allocation.

### Gate 2: Repo Identity Complete

Required before Stage 3:

- Local repo lookup resolves by stable identity before folder name.
- Repair flows no longer treat a valid short local folder as broken.
- Local hard-delete tombstones still match after folder rename.
- Old repo-name folders still resolve as legacy fallback.

Recommended tests:

- Rust tests for local repo resolution.
- Frontend tests for repair/status behavior if UI copy changes.

### Gate 3: New V2 Writes Complete

Required before Stage 4:

- Newly created/imported project, glossary, and QA repos write `.gtms/repo.json`.
- New project chapter folders use short slugs.
- New project image writes use the flat v2 path.
- Image filename allocation is serialized through the repo write queue.

Important constraint:

- This is not release-ready by itself. Old-layout reads may still exist temporarily, and migration is not fully integrated yet.

Recommended tests:

- Rust tests for new repo initialization and image-path writes.
- Existing editor/image tests updated to assert v2 paths.

### Gate 4: Migration 0.8.10 Complete

Required before Stage 5:

- Migration can run directly against legacy project fixtures.
- Migration updates chapter slugs and row image paths.
- Migration records `.gtms/repo.json` and `0.8.10`.
- Migration blocks dirty, diverged, or read-only repos before changing paths.
- Running migration twice is a no-op.

Recommended tests:

- Rust migration fixture tests with long chapter names and nested row image folders.
- Duplicate image filename migration tests.
- Permission and dirty-worktree blocking tests.

### Gate 5: Sync And Clone Integration Complete

Required before Stage 6:

- Sync detects pending migration before normal work.
- Clone avoids checking out legacy long paths before migration.
- Newer-app guard still takes precedence over migration.
- Writers can migrate and push.
- Viewers get a clear migration-required blocked state.
- Diverged repos block safely.

Recommended tests:

- Rust sync/clone integration tests.
- Targeted frontend tests for migration-required status.

### Gate 6: Backup And Restore Complete

Required before Stage 7:

- Restored old-layout repos run migration detection before opening/syncing/writing.
- Restored old local repo plus already-migrated remote re-clones or fast-forwards to v2.
- Repair/rebuild create short local folders and preserve repo identity.
- Viewer restore behavior remains local-only and cannot push migration commits.

Recommended tests:

- Backup/restore tests for old local repos.
- Repair/rebuild tests for short local folder names.

### Gate 7: Release Gate Complete

Required before release:

- No normal app flow writes old project image layout.
- Legacy path handling is isolated to migration code and tests.
- Full test suite passes:
  - `npm test`
  - `cargo test`
- Manual smoke checks pass for create/import, image upload, sync, clone, viewer blocked migration, backup restore, glossary, and QA.

## Cross-Stage Watchpoints

Repo identity:

- Do not use local folder names as durable identity.
- Do not rename GitHub repos as part of this work.
- Do not display truncated local folder names as resource titles.

Migration safety:

- Do not mutate paths before preconditions pass.
- Do not run migration commits for viewers or read-only users.
- Do not let a newer remote app version fall through into migration.

Windows path safety:

- Avoid normal checkout of legacy project image paths before migration.
- Keep old-layout path reads inside migration-only code where possible.
- Prefer Git plumbing/no-checkout strategies when inspecting legacy remote repos.

Editor behavior:

- Do not add permanent rename-aware editor history logic.
- Accept that pre-migration row history may not be shown in the current-path editor UI.
- Ensure current editor image references are updated during migration.

Backup and restore:

- Treat restored repos the same as cloned/synced repos for migration detection.
- If remote is already v2, prefer using remote v2 state instead of operating on restored old paths.

## Rollback Strategy

Before Stage 5:

- Rollback is mostly code rollback because production sync/clone should not depend on migration yet.

After Stage 5:

- Rollback requires care because migration commits may already exist in test repos.
- Do not downgrade migrated repos by rewriting them back to old layout.
- If a migrated repo causes problems, fix forward with a new migration or repair command.

After release:

- Treat `0.8.10` as a permanent storage migration.
- Future fixes should be added as later migration entries in the registry.

## Suggested Commit Boundaries

- Commit 1: Stage 1 helpers and tests.
- Commit 2: Stage 2 repo identity/path resolution.
- Commit 3: Stage 3 v2 writes.
- Commit 4: Stage 4 migration implementation and fixtures.
- Commit 5: Stage 5 sync/clone integration.
- Commit 6: Stage 6 backup/restore integration.
- Commit 7: Stage 7 cleanup, regression test updates, and release prep.

Small corrective commits inside a stage are acceptable, but avoid mixing stage boundaries in one commit unless the code cannot compile otherwise.

## Final Release Checklist

- Parent and stage plans reflect the implemented behavior.
- `rg` confirms old image layout writes are migration-only.
- `npm test` passes.
- `cargo test` passes.
- Manual Tauri smoke test passes.
- Version number is updated.
- Release notes mention:
  - shorter local paths,
  - repo migration on first sync/open,
  - no GitHub repo rename,
  - old apps may be blocked from writing migrated repos by the existing newer-version guard.
