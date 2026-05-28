# Short Path Layout And Repo Migration Pipeline Plan

## Summary

Add a repo migration pipeline and make `0.8.10` the first migration. This migration shortens human-derived local folder and in-repo path components, moves project images into a flatter chapter image folder, and records applied migrations in committed repo metadata.

Full human-readable names remain in team metadata and resource JSON for display. GitHub repo names are not renamed. Local checkout folder names are implementation details and are not the source of truth for repo identity.

## Goals

- Avoid Windows path-length failures caused by long project, chapter, and image paths.
- Keep GitHub repo names, resource titles, and display names human-readable and unchanged.
- Add an ordered migration mechanism so future repo migrations can run step by step.
- Keep legacy path handling isolated to migration code only.
- Avoid permanent editor-history complexity for pre-migration path history.

## Stage Plans

These stage files break the implementation into reviewable chunks. The stages are implementation sequencing, not independent release targets; the release gate is Stage 7.

- [Stage 1: Foundation](short-path-stage-01-foundation.md)
- [Stage 2: Repo Identity And Local Path Resolution](short-path-stage-02-repo-identity.md)
- [Stage 3: New V2 Writes](short-path-stage-03-v2-new-writes.md)
- [Stage 4: Migration 0.8.10](short-path-stage-04-migration-0810.md)
- [Stage 5: Sync And Clone Integration](short-path-stage-05-sync-clone-integration.md)
- [Stage 6: Backup And Restore Integration](short-path-stage-06-backup-restore.md)
- [Stage 7: Regression, Cleanup, And Release Gate](short-path-stage-07-regression-release.md)

## Repo Location Model

- Treat `repoName` and `fullName` as GitHub identity fields only.
- Treat `localFolderName` and resolved `repoPath` as local filesystem implementation details.
- Resolve local repos by stable identity first:
  - project/glossary/QA id,
  - GitHub repo id,
  - GitHub full name,
  - committed `.gtms/repo.json`,
  - local `gnosis-sync-state.json`.
- Use local folder-name matching only as a legacy fallback.
- Local folder names may differ across machines because collision suffixes depend on local state.
- Update repair flows so a local folder name that differs from `repoName` is not reported as a repair issue when stable identity matches.

## Committed Repo Metadata

Add `.gtms/repo.json` to every Gnosis TMS repo.

Recommended shape:

```json
{
  "schemaVersion": 1,
  "repoKind": "project",
  "storageLayoutVersion": 2,
  "appliedMigrations": ["0.8.10"]
}
```

Rules:

- `repoKind` is one of `project`, `glossary`, or `qaList`.
- New repos created by `0.8.10+` write `.gtms/repo.json` immediately.
- Repos missing `.gtms/repo.json` are treated as legacy only after the newer-app guard passes.
- Future migrations are appended to `appliedMigrations` in ordered registry order.
- Migration commits include:
  - `GTMS-Operation: repo.migrate`
  - `GTMS-Migration: 0.8.10`
  - `GTMS-App-Version: <current app version>`

## Migration Decision Algorithm

During project, glossary, and QA repo sync or clone:

1. Fetch remote metadata without materializing old long paths when possible.
2. Inspect the latest remote commit trailer.
3. If the remote app version is newer than the current app, stop with the existing update-required state.
4. Read `.gtms/repo.json` from the target commit if present.
5. Determine pending migrations from the ordered registry.
6. If no migrations are pending, continue normal sync.
7. If migrations are pending:
   - only app writers may run them,
   - viewers/read-only users get a clear migration-required blocked state,
   - migrations run in order,
   - each successful migration updates `.gtms/repo.json`.

Migration `0.8.10` applies when:

- `.gtms/repo.json` is missing and the latest commit was written by Gnosis TMS `0.8.9` or earlier, or
- `.gtms/repo.json` exists but does not list `0.8.10`.

If the repo is missing both `.gtms/repo.json` and a version trailer, treat it as legacy only when old-layout evidence is present. Examples of old-layout evidence:

- project image paths under `chapters/*/images/row-*/*`,
- long chapter folder names,
- missing `storageLayoutVersion`.

## Short Name Rules

Add shared Rust helpers for path-safe short names.

Human-derived folder slugs:

- sanitize to the existing safe slug style,
- truncate the base to 22 characters,
- fallback to `untitled` when empty,
- resolve collisions case-insensitively as `base`, `base-2`, `base-3`.

Image filenames:

- use the final `.` as the extension separator,
- max 22 characters before the final `.`,
- max 5 characters after the final `.`,
- fallback base is `image`,
- preserve the extension when present and valid,
- resolve collisions case-insensitively as `base.ext`, `base-2.ext`, `base-3.ext`.

Stable internal names remain unchanged:

- `.gtms/repo.json`
- `.gitattributes`
- `project.json`
- `chapter.json`
- `glossary.json`
- `qa-list.json`
- `rows/<row-id>.json`
- `terms/<term-id>.json`

## New Storage Layout

Project repo layout:

```text
project.json
.gtms/repo.json
chapters/<chapter-folder>/chapter.json
chapters/<chapter-folder>/rows/<row-id>.json
chapters/<chapter-folder>/images/<image-file-name>
```

Glossary and QA repo layout:

```text
glossary.json
.gtms/repo.json
terms/<term-id>.json
```

```text
qa-list.json
.gtms/repo.json
terms/<term-id>.json
```

New writes:

- Project, glossary, and QA list local checkout folders use short unique local folder names.
- Imported chapter folders use short unique chapter slugs.
- Full chapter titles stay in `chapter.json`.
- Full project/glossary/QA titles and GitHub repo names stay in team metadata and resource JSON.
- Editor image uploads build paths from the resolved chapter folder path, not from `chapterId`.
- Image filename allocation must happen inside the repo write queue for the project/chapter to prevent two concurrent uploads choosing the same flat filename.

## Migration `0.8.10`

Project repo migration:

- Require a clean working tree before migration.
- Rename chapter folders to short unique slugs.
- Update each `chapter.json` `slug` field to the new folder slug.
- For each row image with an uploaded image path:
  - find old paths like `chapters/<chapter>/images/row-.../<file>`,
  - move the image to `chapters/<new-chapter>/images/<short-file>`,
  - resolve duplicate image filenames in that chapter image folder,
  - update the row `image.path`.
- Remove empty old image subdirectories.
- Stage moved files, changed row JSON, changed chapter JSON, and `.gtms/repo.json`.
- Commit and push the migration.

Glossary and QA repo migration:

- Add `.gtms/repo.json`.
- Keep repo contents otherwise unchanged unless future short-path issues are found inside those repos.
- Move the local checkout folder to a short unique local folder when safe.
- Update local sync state with the stable repo identity and storage layout version.

Local checkout folder migration:

- This is local-only and not part of the git migration commit.
- Move local repo folders only after stable identity is known.
- If the desired short local folder already exists:
  - if it is the same repo, reuse it,
  - otherwise append `-2`, `-3`, etc.
- Preserve local git config and `.git/gnosis-sync-state.json`.

## Sync, Clone, And Divergence Policy

Clone path:

- For legacy repos, do not run a normal checkout before migration.
- Use a no-checkout clone/fetch or equivalent plumbing path.
- Inspect commit metadata and tree contents before materializing files.
- Materialize only the migrated v2 layout on Windows so old long paths are never checked out.

Existing local repo path:

- If local HEAD equals remote HEAD, migrate locally and push.
- If local is ahead of remote and remote has not changed since the local base, migrate the local repo and push.
- If local is behind remote, pull/rebase first only when it can be done without materializing legacy long paths; otherwise use the no-checkout migration path or block with a clear migration sync message.
- If local and remote have diverged, block migration and surface a clear conflict state before changing paths.
- If the working tree is dirty or an imported editor conflict exists, block migration until the user resolves or saves the local state.

## Backup And Restore

- Backup restore may reintroduce old-layout local repos.
- After restore, run the same migration detection before opening, syncing, or writing restored repos.
- Viewers may restore local files as before, but they cannot run migration commits for shared repos.
- If a restored local repo is old-layout and the remote has already migrated, re-clone or fast-forward into the v2 layout instead of trying to use old local paths.

## Repair And Recovery Changes

- Update team metadata repair scans so folder-name mismatch is not an error when stable identity matches.
- Repair messages should refer to GitHub repo identity and local checkout path separately.
- Missing-local-repo detection should look for matching `.gtms/repo.json` and sync state before falling back to old folder-name matching.
- Rebuild local repo actions should create short local checkout folders.
- Local hard-delete tombstones should continue to match by stable resource id/full name first; `repoName` matching remains secondary.

## Editor History Decision

- Do not add permanent rename-aware editor history logic.
- Git history remains preserved in the repository through normal migration commits and file renames.
- The editor UI may show only post-migration/current-path history after migration.
- Migration commits may appear as the latest row update for rows whose row files or image paths changed.
- This tradeoff is accepted to keep editor history code simple after the one-time layout migration.

## Affected Areas To Update

- Rust repo path helpers for project, glossary, and QA list local repo resolution.
- Rust repo sync and clone flows for project, glossary, and QA list repos.
- Rust local sync state to record storage layout version and stable identity.
- Rust team metadata repair flows.
- Rust project import and editor image upload paths.
- Rust project/glossary/QA create and import flows to write `.gtms/repo.json`.
- Frontend create/import flows only as needed to stop assuming `repoName` equals local folder name.
- Frontend status/error handling for migration-required states.
- Backup/restore entry points that expose restored repos to the app.

## Test Plan

Rust unit tests:

- Short folder slug truncation to 22 characters.
- Empty slug fallback.
- Case-insensitive collision handling.
- `base`, `base-2`, `base-3` suffix behavior.
- Image base truncation to 22 characters.
- Image extension truncation to 5 characters.
- Image collision suffix inserted before extension.
- `.gtms/repo.json` parse/write round trip.
- Pending migration calculation from missing/applied migrations.

Rust migration tests:

- Legacy project with a long chapter folder migrates to a short chapter folder.
- `chapter.slug` updates after folder rename.
- Nested old image paths migrate to direct chapter image paths.
- Duplicate old image filenames resolve deterministically.
- Row `image.path` values update to new repo-relative paths.
- `.gtms/repo.json` records `0.8.10`.
- Running migration a second time is a no-op.
- Viewer/read-only migration attempt returns migration-required/permission-blocked state.
- Clean but diverged local repo blocks before changing paths.

Sync and clone tests:

- Remote latest commit from `0.8.9` triggers migration.
- Remote current v2 repo does not migrate.
- Remote newer than current app still triggers update-required.
- Legacy clone path does not checkout old paths before migration.
- Rebuild local repo creates a short local checkout folder but preserves remote repo identity.

Frontend tests:

- Migration-required errors show clear status badges/messages.
- Project/glossary/QA local hard-delete tombstones continue matching by id/full name after local folder rename.
- Repair UI does not show folder mismatch warnings for valid short local folder names.
- Existing glossary links keep using glossary id and GitHub repo metadata, not local folder names.

Regression:

- Run `npm test`.
- Run `cargo test`.

## Assumptions

- GitHub repo names stay unchanged.
- Local folder names may differ across machines.
- Only app writers can run and push repo migrations.
- Legacy path support exists only inside migration code.
- Preserving pre-migration editor history in the UI is not required.
