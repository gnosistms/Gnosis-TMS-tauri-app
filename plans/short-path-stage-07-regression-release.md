# Short Path Stage 7: Regression, Cleanup, And Release Gate

## Summary

Finish cleanup, verify no normal app path still writes the old layout, and run the full regression suite before release. This is the only release gate for the staged implementation.

## Scope

- Remove accidental old-layout write paths outside migration code.
- Confirm UI status messages for migration states.
- Run automated test suites.
- Run manual smoke tests on project, glossary, QA, sync, clone, and restore flows.

## Cleanup Checks

Search for old-layout assumptions:

- direct writes to `chapters/<chapter>/images/row-*`,
- code that assumes local folder name equals `repoName`,
- repair code that flags folder mismatch without checking stable identity,
- UI code that displays truncated local folder names as resource titles,
- sync code that performs normal checkout before migration detection.

Allowed legacy references:

- migration code,
- migration tests and fixtures,
- documentation explaining the old layout.

Concrete searches to run:

- `rg "images/row-|row-\\{row_id\\}|row-\\{rowId\\}" src-tauri/src src-ui/app src-ui/screens`
- `rg "join\\(&repo_name\\)|join\\(repo_name\\)|join\\(&.*repo_name" src-tauri/src`
- `rg "repoNameMismatch|current_repo_name|qa_list|qaList" src-tauri/src src-ui/app src-ui/screens`
- `rg "relative_uploaded_image_path|relative_imported_image_path|unique_chapter_slug|slugify\\(" src-tauri/src/project_import`
- `rg "APP_UPDATE_REQUIRED|updateRequired|migrationRequired|migrating" src-tauri/src src-ui/app src-ui/screens`

Status and messages:

- Migration-required should be distinct from generic sync failure.
- Viewer/read-only blocked messages should explain that a writer must migrate.
- Newer-app update-required should still take precedence over migration-required.
- Repair messages should separate GitHub identity and local checkout path.
- Projects, glossaries, and QA lists should use consistent status terms and message structure.
- Notice badges should clear when a migration is blocked or complete; do not leave refresh buttons spinning on terminal migration states.

## Automated Tests

Run:

- `npm test`
- `cargo test`

Required coverage:

- short-name helper tests,
- repo metadata parse/write tests,
- migration resolver tests,
- project migration fixture tests,
- glossary and QA metadata migration tests,
- sync/clone migration integration tests,
- backup/restore migration detection tests,
- frontend migration-required status tests.
- frontend repair UI tests proving short local folder names do not produce folder mismatch warnings.
- editor image upload/import tests proving flat v2 paths are used.
- export tests proving flat v2 image paths still render/export.
- local hard-delete tests proving stable-id matching survives folder rename.

## Manual Smoke Tests

- Create a new project and confirm `.gtms/repo.json` exists.
- Import a chapter with a long title and confirm the folder is short while the UI title is full.
- Upload/import multiple images with long names and confirm flat image paths.
- Sync a new v2 project across machines/users.
- Clone a legacy `0.8.9` project and confirm migration runs before normal checkout.
- Open as viewer/read-only when migration is pending and confirm blocked state.
- Restore a backup containing old-layout repos and confirm migration/re-clone behavior.
- Confirm glossary and QA list create/import/sync still work.
- Rename a project, chapter, glossary, and QA list and confirm display names remain full while local paths stay short.
- Upload two images with the same long filename to the same chapter and confirm deterministic suffixes.
- Replace and remove an uploaded image and confirm old files are cleaned up.
- Open the Review/History and export flows for a row whose image path was migrated.

## Acceptance Criteria

- No normal app path writes old project image layout.
- New and migrated repos use v2 layout.
- Old-layout support is isolated to migration code and tests.
- Full test suite passes.
- Manual smoke tests pass before release.

## Existing-Code Risks

- The release stage must keep `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json` on the same app version. If Cargo lags behind, commit trailers will not advertise the migrated version.
- `GitCommitMetadata` appends the version trailer from Cargo. Version validation and migration tests should read the same version source, not a frontend package version.
- Existing tests may intentionally use old image paths as fixtures. Keep those only in migration tests or update them to v2 paths.
- Browser/frontend tests will not catch Windows checkout failures. Add Rust-level tests around no-checkout clone/migration logic and manually smoke on Windows before release if possible.
- Release notes must warn that repos migrated by `0.8.10+` are protected by the newer-app guard; older app versions should not write them.
