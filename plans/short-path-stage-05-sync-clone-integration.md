# Short Path Stage 5: Sync And Clone Integration

## Summary

Wire the migration pipeline into project, glossary, and QA sync/clone flows. This is the stage that prevents Windows from checking out legacy long paths and ensures old repos migrate before normal app use.

## Scope

- Run migration detection during sync and clone.
- Preserve the newer-app guard before any migration work.
- Avoid normal checkout of legacy project paths when they may exceed Windows limits.
- Run migrations in order for writers.
- Block viewers/read-only users with a clear migration-required state.

## Implementation Details

Existing code touchpoints:

- Project sync entry points are in `src-tauri/src/project_repo_sync.rs`: `inspect_project_repo_state`, `sync_project_repo`, `clone_project_repo`, and `enforce_remote_project_app_version`.
- Glossary sync entry points are in `src-tauri/src/glossary_repo_sync.rs`: `inspect_glossary_repo_state`, `sync_glossary_repo`, `clone_glossary_repo`, and `enforce_remote_glossary_app_version`.
- QA list sync mirrors glossary sync in `src-tauri/src/qa_list_repo_sync.rs`.
- Frontend project sync status handling is in `src-ui/app/project-repo-sync-flow.js` and `src-ui/app/project-repo-sync-shared.js`.
- Glossary and QA sync issue handling is in `src-ui/app/glossary-repo-flow.js` and `src-ui/app/qa-list-repo-flow.js`.
- App update status UI is already supported by `src-ui/screens/app-update-modal.js` and `src-ui/app/updater-flow.js`; migration-required should be a separate status, not an app-update payload.

Decision order:

1. Fetch remote metadata without materializing old long paths when possible.
2. Inspect latest commit trailers.
3. If the latest app version is newer than the current app, return the existing update-required state.
4. Read `.gtms/repo.json` from the target commit if present.
5. Detect old-layout evidence when metadata is missing.
6. Resolve pending migrations from the registry.
7. If pending migrations exist:
   - require writer permission,
   - run migrations in registry order,
   - push the migration commit,
   - restart or continue normal sync against the migrated commit.
- Add a new sync status such as `migrationRequired` or `migrating` rather than overloading `syncError`.
- Keep `updateRequired` precedence exactly as it is today: newer app version must short-circuit before migration detection.
- Add a shared migration decision function for project/glossary/QA sync so glossary and QA do not drift from project behavior.

Clone path:

- For legacy repos, use no-checkout clone/fetch or Git plumbing before materializing files.
- Inspect the tree and metadata from the fetched commit.
- On Windows, do not checkout old-layout project paths before migration.
- Materialize only the v2 layout after migration.
- Replace normal `git clone` in `clone_project_repo` for legacy project repos with a no-checkout path:
  - create repo folder,
  - `git init`,
  - add origin,
  - fetch target branch,
  - inspect commit metadata/tree with `git show`, `git ls-tree`, or equivalent,
  - run migration against a safe checkout/index strategy,
  - checkout v2 result only after migration.
- Glossary and QA do not have the long nested image path issue, but still need metadata/migration detection so all repo kinds share the same storage-layout version.

Existing local repo path:

- If local HEAD equals remote HEAD, migrate locally and push.
- If local is ahead and remote has not changed from the local base, migrate local changes and push.
- If local is behind, use a path that avoids checking out old long paths before migration.
- If local and remote diverged, block migration and show a conflict state.
- If working tree is dirty, block until saved/resolved.
- Existing project sync currently calls `backup_dirty_project_worktree` before pull. Migration should run before backup/rebase when a repo is clean and pending migration, otherwise the backup branch can capture old paths and confuse migration state.
- Existing glossary/QA sync only checks dirty state and then pulls/rebases. Add migration detection before pull/rebase.

Status and UI:

- Surface migration-required as a distinct status from normal sync errors.
- Viewer/read-only copy should explain that a writer must open/sync the repo with the newer app first.
- Do not show generic missing-local-repo repair when the real issue is pending migration.
- Update project snapshot summaries so migration statuses count as attention-needed but do not trigger the app update modal.
- Update QA/glossary `get*SyncIssueMessage` helpers to show migration-specific text.
- Ensure page refresh badges stop when migration is blocked, just like other terminal sync states.

## Existing-Code Risks

- `clone_project_repo`, `clone_glossary_repo`, and `clone_qa_list_repo` currently do normal `git clone`, which checks out files immediately. For legacy project repos on Windows, this can reproduce the filename error before migration code runs.
- Project sync uses an async snapshot/poll loop. A new `migrating` status must eventually resolve to `upToDate`, `migrationRequired`, or `syncError`; otherwise the Projects refresh badge can spin forever.
- Frontend `PROJECT_REPO_SYNC_STATUS_UPDATE_REQUIRED` opens the app update modal. Migration-required must not reuse the `APP_UPDATE_REQUIRED:` encoded error prefix.
- Queueing sync through `repo-write-queue.js` is important. Migration writes must use the same repo scope as editor/project writes to avoid racing row saves or image uploads.
- Glossary and QA sync modules are near copies. Changes must be applied to both or QA metadata parity can regress.
- If a migration commit is pushed, the remote head changes. Sync snapshots must report the new head as both local and remote after push.

## Tests

- Remote latest commit from `0.8.9` triggers `0.8.10`.
- Remote current v2 repo does not migrate.
- Remote newer than current app returns update-required before migration.
- Legacy clone path does not checkout old paths before migration.
- Writer sync runs migration and then normal sync.
- Viewer sync gets migration-required/permission-blocked state.
- Diverged local repo blocks before changing paths.
- Rebuild local repo creates a short local checkout folder while preserving GitHub repo identity.
- Project frontend summary counts migration-required as an issue and does not open the app-update modal.
- Polling stops on terminal migration-required/sync-error states.
- Migration writes are serialized with existing project repo write queue scopes.
- Glossary and QA sync both add `.gtms/repo.json` migration metadata and report the same status semantics.

## Acceptance Criteria

- Normal sync/clone never writes or checks out old-layout project images after migration detection.
- Old repos are migrated once by writers.
- Viewers are blocked safely and clearly when migration is required.
