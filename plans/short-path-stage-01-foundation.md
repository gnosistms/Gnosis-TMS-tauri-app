# Short Path Stage 1: Foundation

## Summary

Add the shared primitives needed by the short-path migration without changing normal sync, clone, or editor behavior yet. This stage should be safe to land because it introduces reusable helpers, metadata parsing, and tests before any production flow depends on them.

## Scope

- Add a committed repo metadata model for `.gtms/repo.json`.
- Add a migration registry and pending-migration resolver.
- Add shared short-name allocation helpers.
- Extend local sync state models only where needed to carry storage-layout information.
- Add focused Rust unit tests for the new helpers.

## Implementation Details

Existing code touchpoints:

- Add a new Rust module such as `src-tauri/src/repo_layout_metadata.rs` for committed `.gtms/repo.json` parsing/writing.
- Add a new Rust module such as `src-tauri/src/repo_migrations.rs` for migration registry types and pending-migration resolution.
- Add a new Rust module such as `src-tauri/src/short_path_names.rs` for short folder and image filename allocation.
- Extend `src-tauri/src/local_repo_sync_state.rs` rather than creating a parallel local state file.
- Reuse `src-tauri/src/repo_app_version.rs` for current-version and remote-version comparisons. If needed, expose narrowly scoped helpers instead of duplicating version parsing.
- Extend `src-tauri/src/git_commit.rs` metadata support so migration commits can include `GTMS-Migration: 0.8.10`; today `GitCommitMetadata` only supports operation, status note, AI model, and app version.

Committed repo metadata:

- Add a Rust type for `.gtms/repo.json`.
- Fields:
  - `schemaVersion: 1`
  - `repoKind: "project" | "glossary" | "qaList"`
  - `storageLayoutVersion: 2`
  - `appliedMigrations: Vec<String>`
- Add parse/write helpers that preserve strict validation:
  - reject unknown `repoKind`,
  - reject unsupported `schemaVersion`,
  - treat missing `appliedMigrations` as empty only for migration detection, not for writing new metadata.

Migration registry:

- Add an ordered registry with the first entry `0.8.10`.
- Add a resolver that accepts:
  - current repo metadata, if present,
  - latest commit app-version trailer,
  - optional legacy-layout evidence,
  - current app version.
- Resolver output should distinguish:
  - no migration needed,
  - pending migrations,
  - update-required because remote app version is newer,
  - unknown repo layout.

Short-name helpers:

- Folder names:
  - sanitize using the existing repo-safe slug rules,
  - truncate the base to 22 characters,
  - fallback to `untitled`,
  - resolve collisions case-insensitively as `base`, `base-2`, `base-3`.
- Image filenames:
  - split on the final `.`,
  - truncate base to 22 characters,
  - truncate extension to 5 characters,
  - fallback base to `image`,
  - append collision suffix before the extension.
- Helpers should accept an existing-name set and return the allocated name plus enough metadata for tests to verify truncation and suffixing decisions.

Local sync state:

- Add or reuse fields for:
  - stable repo identity,
  - storage layout version,
  - local folder name,
  - last known GitHub full name.
- Prefer extending existing state shapes over adding duplicate identity concepts.
- Current `LocalRepoSyncState` already has `resource_id`, `current_repo_name`, `kind`, `last_known_github_repo_id`, and `last_known_full_name`; add only the missing fields, likely `storage_layout_version` and `local_folder_name`.
- Normalize kind values at this boundary. Current code uses `project`, `glossary`, `qa_list`, and `qaList` in different places; the foundation should define one canonical internal enum and explicit serialization aliases.

## Existing-Code Risks

- `repoKind` and sync-state `kind` are easy to mismatch. If `.gtms/repo.json` uses `qaList` while sync state writes `qa_list`, repo identity scans may miss valid QA repos.
- `repo_app_version.rs` currently hides `extract_commit_app_version` and `compare_app_versions`. Duplicating them in migration code would create inconsistent newer-app behavior.
- `git_commit.rs` always appends `GTMS-App-Version`, but it does not yet support a migration trailer. Adding migration commits by bypassing `git_commit_as_signed_in_user_with_metadata` would risk skipping viewer/write-permission checks.
- Short-name truncation should happen after slug sanitization. Truncating before sanitization can produce empty names or unexpected suffix lengths.
- Collision checks must be case-insensitive even on macOS/Linux, because the bug is Windows-oriented and Windows filename behavior is usually case-insensitive.
- This stage should not write `.gtms/repo.json` in production flows yet. Doing so early can make repos appear migrated before Stage 4/5 can actually enforce the layout.

## Tests

- `.gtms/repo.json` parse/write round trip.
- Invalid repo kinds and unsupported schema versions fail clearly.
- Pending migration calculation:
  - missing metadata plus `0.8.9` trailer schedules `0.8.10`,
  - metadata with `0.8.10` does not schedule it,
  - newer remote app version returns update-required before migration.
- Folder slug truncation, empty fallback, and case-insensitive collisions.
- Image base truncation, extension truncation, suffix placement, and case-insensitive collisions.
- Sync-state compatibility tests for old records missing the new fields.
- Kind normalization tests covering `qa_list` and `qaList`.
- Commit metadata tests confirming `GTMS-Migration` can be emitted without dropping `GTMS-App-Version`.

## Acceptance Criteria

- New helper modules are covered by unit tests.
- Existing sync, clone, editor, project, glossary, and QA flows are not wired to the migration path yet.
- No user-visible behavior changes are expected in this stage.
