# Move uploaded images left in per-row folders (0.8.138 content migration)

## Problem

PDF and EPUB export fail on some chapters with "An uploaded image is missing…"
because rows reference flat image paths where no file exists. Field case
(2026-10-28, `meditation-chamber-books`, Spanish chapters 11, 13–18, 20, 21,
21a, 22; `zoroastro-letters` chapter `cual_gnosis_revisado`, 25 references in
all):

- row `chapters/13-el-sutra-del-coraz/rows/019e674b-…-221d71c56144.json`,
  field `es`, references
  `chapters/13-el-sutra-del-coraz/images/embedded-image-2.png` (missing);
- the only file is
  `chapters/13-el-sutra-del-coraz/images/row-019e674b-…-221d71c56144-es-019e674b-…-222a02ac54e5/embedded-image.png`.

The layout commit (`27be73c5 Migrate repo layout to 0.8.10`) renamed the
chapter folder `13-el-sutra-del-coraz-n` → `13-el-sutra-del-coraz`, rewrote
the row to the flat path, and carried the nested image along with the folder
rename without flattening it.

### Root cause

`migrate_project_repo_to_0810` renames every chapter folder first, then calls
`migrate_project_chapter` → `migrate_uploaded_image_path` for each row. That
function rewrites the reference to a newly allocated flat name, but looks for
the file to move at `repo_path.join(<stored path>)` — the **pre-rename**
folder. For every renamed chapter that path no longer exists, so the
`source_path.exists()` guard silently skips the move while the row is still
rewritten. Chapters whose folder name did not change (e.g.
`12-om-masi-padme-yon`) were flattened correctly.

The 0.8.75 repair cannot fix this: it matches by the path remainder after
`images/`, and the flat name (`embedded-image-2.png`) never equals the nested
remainder (`row-…/embedded-image.png`).

## Fix

### 1. Root cause in the 0.8.10 in-place migration

`migrate_uploaded_image_path` looks for the source at the path inside the
**new** chapter folder (where the rename put it). If the file is not there
either, it keeps the reference pointing at the chapter-relocated path and does
not allocate a flat name for a file it cannot move. Repos still pending 0.8.10
then migrate correctly.

### 2. New content migration `MIGRATION_08138 = "0.8.138"`

Registered after 0.8.75 (Project repos only), same execution model as
0.8.56/0.8.75: skip on dirty worktree, tolerant per-file edits, metadata
marker, one mergeable commit (`operation: repo.migrate`).

`repair_nested_uploaded_image_files(repo_path, chapters_root)`:

1. Walk `chapters/*/rows/*.json` in sorted order (deterministic, so two team
   members running it independently produce identical, mergeable results).
   Unparseable rows are skipped and counted.
2. For each `fields.<lang>.image` with `kind == "upload"` whose file is
   missing, require the current flat shape
   `chapters/<chapter>/images/<name>` (the shape
   `relative_uploaded_image_path` produces). Anything else that is missing is
   counted as unresolved.
3. Candidates: files under `chapters/<chapter>/images/row-<rowId>-<lang>-<uuid>/`
   — row id from the row file name, `<lang>` the field key, and the suffix
   must parse as a UUID so `pt` never matches `pt-BR` folders. Keep only
   candidates whose name, allocated with no siblings, is `<name>` or a
   `-N` variant of it (the names the 0.8.10 migration allocated), so an
   unrelated leftover is never renamed into place.
4. Exactly one candidate → move it to the referenced flat path; the row stays
   unchanged. If that path was already taken (two references allocated the
   same name), allocate a fresh unique name in the chapter's `images/` folder
   with `allocate_short_image_filename` and rewrite that row's reference.
   Remove the emptied per-row folder.
5. Zero or several candidates → leave the reference untouched and count it.

Moving the file (rather than pointing rows back at the nested file) keeps rows
in the current flat layout, leaves row JSON untouched in the common case, and
makes new uploads allocate around the real file names.

The migration rewrites `.gtms/image-path-repair.json` from its own outcome. It
inspects every missing chapter-image reference, so its report supersedes the
0.8.75 one.

### 3. Safety guard in the 0.8.75 repair

`repair_stale_uploaded_image_paths` is documented as repairing references to
chapter folders that no longer exist, but it relocates any missing reference
whose `images/` remainder is unique repo-wide. For flat references like
`chapters/A/images/embedded-image.png` that would point a row at another
chapter's image when exactly one other chapter has that name. Restrict the
relocation to references whose chapter folder is gone; others are counted as
unresolved. Repos still pending 0.8.75 run it before 0.8.138, so this guard
keeps it from claiming the nested-folder cases first.

## Files

- `src-tauri/src/repo_layout_metadata.rs` — `MIGRATION_08138`.
- `src-tauri/src/repo_migrations.rs` — root-cause fix, guard, registry
  entry, `migrate_project_repo_to_08138`, `repair_nested_uploaded_image_files`,
  tests.
- `src-tauri/src/project_repo_sync.rs` — tests that record "all content
  migrations" include the new id.

## Tests

- In-place 0.8.10 migration of a renamed chapter flattens the nested image and
  the row reference resolves.
- Nested-file/flat-reference state (the field case) is repaired by moving the
  file; a second run changes nothing.
- Two references allocated the same flat name → second gets a fresh name and
  its row is rewritten.
- Ambiguous (two nested folders), name-mismatched, language-prefix (`pt` vs
  `pt-BR`) and unlocatable cases are left untouched and counted.
- 0.8.75 no longer relocates a reference whose chapter folder exists.
- Registry/pending-state tests include 0.8.138.

## Non-goals

- No read-time fallback in export; repos heal through the migration.
- No change to the no-checkout tree migration path (it keeps nested
  references consistent with nested files).
- A dangling flat reference whose name a later upload in the same chapter
  re-used (the file exists, but holds the other upload) is indistinguishable
  from a valid reference without history and is not detected. None of the
  locally cached repos shows this state (no row has both an existing flat
  file and a nested leftover for its own row and language).
