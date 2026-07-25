# Repair stale uploaded-image paths (0.8.75 content migration)

## Problem

Rows can reference uploaded images by repo-relative paths that no longer
exist. Confirmed field case (2026-07-25, project p1, chapter
"5-práctica-de-interiorización…"): four rows store
`chapters/019d80f1-f491-7292-b68c-db306df4468f/images/…` (full chapter id)
while the files live at `chapters/019d80f1-f491-7292-b68/images/…` (22-char
truncated dir). The 0.8.10 layout migration renamed the orphaned images
directory and rewrote image paths **only inside row files it was itself
moving** — rows already living in short-named chapter dirs kept their stale
full-id references. The images render as 404s, but every file is intact on
disk. The stale references are committed content, so every clone of an
affected repo shows the same broken images.

## Fix

A new **content** migration (`MIGRATION_0875 = "0.8.75"`), registered after
`MIGRATION_0856` in `REPO_MIGRATION_REGISTRY` (Project repos only), following
the 0.8.56 template exactly: skip on dirty worktree, tolerant per-file edits,
metadata marker, one mergeable commit (`operation: repo.migrate`). Both sides
of a team can run it independently and merge cleanly.

### Repair rule (pure function, app-free, unit-tested)

`repair_stale_uploaded_image_paths(repo_path)`:

1. Index every existing file under `chapters/*/images/**` by its path
   remainder after `images/` (covers both the old per-row-subdirectory layout
   and the current flat layout).
2. Walk every `chapters/*/rows/*.json` (unparseable files are skipped and
   counted, mirroring 0.8.56's corrupt-file tolerance). Recursively find
   objects with `kind == "upload"` and a string `path` — recursion avoids
   coupling to the row schema.
3. Normalize the stored path's separators (Windows history may hold
   backslashes), and parse it as `chapters/<dir>/images/<rest>`.
4. If the referenced file exists on disk: leave it.
5. If missing: look up `<rest>` in the index. Exactly one candidate → rewrite
   the stored path to it. Zero or multiple candidates → leave the reference
   untouched and count it (ambiguity must never guess; a later manual fix or
   re-upload stays possible). Report skip counts via the nonfatal telemetry
   event like 0.8.56 does.

No files are moved — only the row references are rewritten to where the
files already are. The leftover truncated-id directory keeps its images and
becomes correctly referenced.

### Files

- `src-tauri/src/repo_layout_metadata.rs` — `MIGRATION_0875` constant.
- `src-tauri/src/repo_migrations.rs` — registry entry,
  `migrate_project_repo_to_0875` wrapper, `repair_stale_uploaded_image_paths`
  + unit tests (temp-repo pattern already in the file's test module):
  unique-match rewrite, valid path untouched, ambiguous match untouched,
  missing-everywhere untouched, nested and flat remainders, backslash
  normalization.

## Non-goals

- No file moves or directory consolidation.
- No read-time fallback in the asset URL path — repos heal through the
  migration, keeping data consistent for every client including exports.
