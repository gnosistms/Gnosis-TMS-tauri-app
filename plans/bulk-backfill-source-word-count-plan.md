# Bulk backfill of cached source word counts (TEMPORARY)

**Status:** active. **Added:** 2026-06-09. **Remove after:** ~2026-06-23 (one to two weeks
after release), once existing teams have refreshed their projects pages at least once.

## Problem

#94 caches `source_word_count` in `chapter.json` so the projects page does not read every
row of every chapter per refresh. The cache backfills when a chapter is opened in the
editor — fine for small projects, but teams with many files would wait indefinitely for
every file to be opened organically.

## Approach

No separate migration command. The projects-refresh fallback path
(`load_project_chapter_summaries`) already computes word counts from rows for every
chapter that has no cached value. The temporary code persists what that fallback already
computed:

- `load_project_chapter_summaries` additionally returns `(chapter.json path, source count)`
  for every chapter that fell back to row reads.
- `list_local_gtms_project_files_sync` hands those to a batched persist: write all
  `chapter.json` files (Value-based edit, unknown keys preserved), one `git add` + **one
  commit per project** ("Backfill cached source word counts").
- Best-effort with the same safety as the editor-load backfill: `ensure_repo_allows_writes`
  pre-check (viewers are a clean no-op and just keep the slower fallback), full
  file + index rollback if anything after the first write fails.

After one projects refresh per project, every chapter is cached and the backfill never
runs again. Teammates receive the cached values through normal repo sync.

## Removal (the actual temp code)

Delete, in `src-tauri/src/project_import/chapter_editor/`:
1. The backfill-collection in `load_project_chapter_summaries` (shared.rs) — revert its
   return type to `Vec<ProjectChapterSummary>`.
2. `backfill_chapter_source_word_counts` (shared.rs) and its call in
   `list_local_gtms_project_files_sync` (mod.rs).

Keep forever: the read-side cache + fallback, the editor-load refresh, the batched persist
helper used by the editor-load path, and the merge-resolver rule.
