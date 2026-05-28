# Short Path Stage 4: Migration 0.8.10

## Summary

Implement the `0.8.10` repo migration itself. This stage should make migration reliable in isolated working-tree tests before sync and clone flows invoke it automatically.

## Scope

- Add a migration runner for project, glossary, and QA repos.
- Migrate project chapter folders and image paths to v2 layout.
- Add `.gtms/repo.json` to migrated repos.
- Move local checkout folders to short names when safe.
- Keep editor history logic simple and current-path based after migration.

## Implementation Details

Existing code touchpoints:

- Put migration code in a dedicated Rust module, for example `src-tauri/src/repo_migrations/migration_0810.rs`, not inside the sync functions.
- Reuse JSON helpers from `src-tauri/src/project_import/project_git.rs` where possible, but avoid making migration depend on editor-only structs.
- Image references are stored inside row JSON language fields. Existing helpers in `src-tauri/src/project_import/chapter_editor/images.rs` can identify uploaded image paths, but migration should operate on raw JSON too so it can preserve unknown fields.
- `src-tauri/src/project_import/chapter_editor/shared.rs` builds row image maps from stored paths; migration must update those stored paths before the editor loads.
- `src-tauri/src/project_search/mod.rs` and `src-tauri/src/project_search/refresh.rs` derive chapter paths from Git diffs and filesystem scans; migration tests should include renamed chapter directories so search refresh keeps working.

Migration preconditions:

- Require a clean working tree.
- Block migration if local and remote have diverged.
- Block migration if imported/editor conflict state is unresolved.
- Do not change paths before preconditions pass.
- Only app writers may run migrations that commit and push.
- Use existing imported-editor-conflict detection before migration. Project sync currently blocks when `repo_has_imported_editor_conflicts` is true; migration should use the same rule.
- Check the Git index and working tree before filesystem renames. A failed precondition after partial file moves is harder to recover.

Project repo migration:

- Enumerate chapters from current project/chapter metadata.
- Allocate new chapter folder slugs with the shared short folder helper.
- Rename chapter folders to the allocated slugs.
- Update each `chapter.json` `slug` field to match the new folder slug when that field exists.
- Scan each chapter image area for old uploaded image folders such as:

```text
chapters/<chapter>/images/row-.../<file>
```

- Move each image to:

```text
chapters/<new-chapter>/images/<short-file>
```

- Resolve duplicate image filenames within the target chapter image folder.
- Update row `image.path` values to the new repo-relative path.
- Remove empty old `images/row-*` directories.
- Stage moved files, changed row JSON, changed chapter JSON, and `.gtms/repo.json`.
- Commit with:
  - `GTMS-Operation: repo.migrate`
  - `GTMS-Migration: 0.8.10`
  - `GTMS-App-Version: <current app version>`
- Prefer `git mv` for tracked chapter directories and images when the source is tracked; fall back to filesystem rename plus `git add -A` for untracked or partially tracked files.
- Update row JSON as raw `serde_json::Value` so text, styles, flags, comments, and future fields remain untouched.
- Detect old uploaded image paths by shape, not by assuming every image under `images/` needs moving:
  - path starts with `chapters/`,
  - contains `/images/row-`,
  - has one directory between `images/` and the filename.
- Leave URL images unchanged.
- Preserve old image files that are not referenced by any row only if deleting them would be risky; if removed, record that decision in tests and commit paths.
- Write `.gtms/repo.json` last, after all planned path rewrites succeed.

Glossary and QA migration:

- Add `.gtms/repo.json`.
- Do not change internal term paths unless a future migration requires it.
- Move the local checkout folder to a short unique local folder when safe.
- Update local sync state with stable identity and storage layout.

Local checkout folder migration:

- Treat local folder renaming as local-only.
- Move only after stable repo identity is known.
- If the desired folder already exists:
  - reuse it when it is the same repo,
  - otherwise allocate a suffix.
- Preserve `.git`, Git config, and `.git/gnosis-sync-state.json`.

History policy:

- Do not add permanent rename-aware editor history code.
- Git history remains preserved through normal renames and commits.
- The editor may show only current-path history after migration.

## Existing-Code Risks

- `chapter_lifecycle.rs` hard-deletes deleted chapters by folder path. If migration changes folder names but not `chapter_id`, lifecycle commands are safe only if they keep using `find_chapter_path_by_id`.
- Editor commands in `row_fields.rs`, `row_structure.rs`, `comments.rs`, `history.rs`, and image flows all resolve chapter folders by id. Tests should catch any leftover direct `chapters/<chapterId>` usage.
- Project search code may interpret migration renames as deleted/inserted chapters. That is acceptable for indexing, but should not create duplicate visible chapters.
- Migration commits can look like the latest row update because row JSON changes. This is an accepted tradeoff, but the Review/History UI should not crash when latest commit operation is `repo.migrate`.
- Rollback must account for both JSON changes and file moves. A simple JSON rollback is not enough if image files were already moved.
- On Windows, filesystem operations may still hit path limits if migration starts from a normally checked-out legacy repo. Stage 5 handles no-checkout clone; Stage 4 tests can use ordinary temp repos but should not assume that is enough for Windows clone safety.

## Tests

- Legacy project with long chapter folder migrates to a short folder.
- `chapter.slug` updates after folder rename.
- Old nested image paths become flat chapter image paths.
- Duplicate old image filenames resolve deterministically.
- Row `image.path` values are updated.
- Empty old image subdirectories are removed.
- `.gtms/repo.json` records `0.8.10`.
- Running migration a second time is a no-op.
- Dirty working tree blocks before changes.
- Diverged repo blocks before changes.
- Viewer/read-only migration attempt is blocked before commit.
- Migration preserves row text, text style, comments, editor flags, order keys, and unknown JSON fields.
- URL images are left unchanged.
- Referenced old uploaded images move; unreferenced files are handled according to the explicit migration policy.
- Project search refresh after migration indexes the migrated chapter once.
- Editor history/review load succeeds for rows touched by migration.

## Acceptance Criteria

- The migration can be run directly in tests against legacy fixtures.
- Migrated repos are valid v2 repos.
- Migration failures leave the repo unchanged or clearly recoverable.
