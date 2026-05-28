# Short Path Stage 6: Backup And Restore Integration

## Summary

Make backup restore, local repair, and local rebuild flows compatible with v2 repo identity and old-layout migration. Restored old-layout repos must be migrated or replaced with the already-migrated remote before the app opens or writes them.

## Scope

- Run migration detection after backup restore.
- Reconcile restored old local repos with already-migrated remotes.
- Update repair and rebuild flows to create short local folders.
- Keep viewer restore behavior local-only while blocking shared migration commits.

## Implementation Details

Existing code touchpoints:

- The repo lifecycle restore flows today are resource-specific:
  - project restore in `src-ui/app/project-flow.js`,
  - chapter restore in `src-ui/app/project-chapter-flow.js`,
  - glossary restore in `src-ui/app/glossary-lifecycle-flow.js`,
  - QA list restore in `src-ui/app/qa-list-lifecycle-flow.js`.
- Local hard-delete and purge paths use:
  - `purge_local_gtms_project_repo`,
  - `purge_local_gtms_glossary_repo`,
  - `purge_local_gtms_qa_list_repo`,
  - `src-ui/app/local-hard-delete-store.js`.
- Team-local repair/rebuild logic is in `src-tauri/src/team_metadata_local/repair.rs` and frontend orchestration is in `src-ui/app/team-metadata-flow.js`.
- A dedicated backup/restore module is not obvious in the current tree; when that feature is added, it must call the same migration detection code as sync/clone rather than inventing a separate restore scanner.

After restore:

- Scan restored project, glossary, and QA local repos.
- Resolve stable identity for each restored repo.
- Check local metadata, remote metadata, and latest commit trailers before opening/syncing/writing.
- If the restored repo is old-layout and remote is also old-layout:
  - writers may run the migration,
  - viewers/read-only users get migration-required.
- If the restored repo is old-layout but remote is already v2:
  - prefer re-clone or fast-forward into the v2 layout,
  - do not continue using old local paths.
- Add a single "post-restore repo reconciliation" function that accepts installation id and optional affected resource ids, then delegates to the same migration decision path used by Stage 5.
- Reconciliation should run before any UI flow opens an editor/glossary/QA list from restored data.
- Restored repos with no remote should still get local-folder identity repair and `.gtms/repo.json` only if the current user has write permission and the repo is intended to remain shareable.

Local hard-delete and tombstones:

- Continue matching by stable resource id and GitHub full name first.
- Keep `repoName` as secondary fallback.
- Folder renames during migration must not accidentally unhide locally hard-deleted repos.
- When remote metadata says a repo has been restored to active, clear local tombstones only after a v2 local repo exists or can be cloned.
- Do not clear tombstones solely because a restored backup contains an old folder with a matching repo name.

Repair and rebuild:

- Missing local repo detection should search `.gtms/repo.json` and sync state before folder-name fallback.
- Rebuild should create short local checkout folders.
- Repair messages should separate GitHub repo identity from local checkout path.
- A local folder mismatch is not a repair issue when stable identity matches.

Viewer behavior:

- Viewers may restore local files according to existing backup rules.
- Viewers cannot run migration commits or push shared repo migrations.
- If a viewer restores an old shared repo that requires migration, the UI should say a writer must migrate it first.

## Existing-Code Risks

- Local purge functions physically remove repo folders. After short folder names, purge must resolve by stable identity; otherwise an old `repoName` folder can survive and later be mistaken for the live repo.
- `clearRestoredLocalHardDeleteTombstones` clears tombstones for active resources. If restored old local state marks something active before remote v2 is available, it can prematurely unhide a locally hard-deleted resource.
- Repair scans currently can produce `repoNameMismatch`; that must not reappear after a restore simply because the restored folder is short.
- Resource restore and backup restore are different operations. Do not let ordinary soft-delete restore skip migration detection if it causes a previously hard-deleted repo to be cloned again.
- Viewers can hard-delete local files, but they cannot push migration commits. Restore UI needs to distinguish "local restore is allowed" from "shared repo migration is blocked."
- If a backup restores `.git` directories with interrupted rebase/merge state, migration detection should surface repair/conflict states before attempting path rewrites.

## Tests

- Restored old-layout local repo triggers migration detection before open/sync/write.
- Restored old-layout local repo plus v2 remote re-clones or fast-forwards to v2.
- Viewer restore of old shared repo is blocked from migration commit.
- Rebuild creates short local folder while preserving stable identity.
- Repair scan does not warn for valid short folder names.
- Local hard-delete tombstones remain effective after folder rename.
- Purge/local hard-delete resolves short folders by stable id and does not leave stale old-name folders as false live repos.
- Restored backup with interrupted Git state produces a repair/conflict state rather than running migration.
- Tombstone clearing waits for active metadata plus a usable v2 local repo or clone path.

## Acceptance Criteria

- Backup restore cannot silently reintroduce old writable paths.
- Repair/rebuild are consistent with the new repo identity model.
- Viewer behavior remains local-only and cannot push migrations.
