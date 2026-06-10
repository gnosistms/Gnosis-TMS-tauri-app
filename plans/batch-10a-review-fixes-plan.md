# Batch 10a Review Fixes — Chapter Editor Core

Resolves the findings from `reviews/2026-06-10-batch-10a-review.md` (S1, M1, m1; m2
deferred). Branch: `fix/batch-10a-review-findings`. One focused commit per finding.

## S1 — Validate `row_id` before it reaches `Path::join`

`chapter_editor/shared.rs`:
- Add `validated_row_json_path(chapter_path, row_id) -> Result<PathBuf, String>`:
  trim; reject empty, `.`, `..`, and any char outside `[A-Za-z0-9._-]` (excludes
  `/`, `\`). Mirrors `validated_resource_id` from the Batch 8 fix (`9bb2de65`).
- Route every `chapter_path/rows/{row_id}.json` construction through it:
  `mod.rs` (`load_gtms_editor_row_sync`), `row_fields.rs` (single save, batch loop,
  flag update, AI review, text style, clear reviewed markers), `row_structure.rs`
  (lifecycle, permanent delete). Insert keeps its generated UUIDv7 path.
- Defense in depth: in the commands that resolved `repo_relative_path` (the lexical
  escape check) only after mutating the file, resolve it before the first write.
- Unit tests: traversal ids rejected, uuid-ish ids pass, ids are trimmed.

## M1 — No dirty working tree when the commit gate fails

`git_commit.rs`:
- Add `ensure_local_commit_preconditions(app, repo_path)`: runs
  `ensure_repo_allows_writes` + the signed-in-session check (both local file reads)
  so mutation paths can fail the *expected* gate failures before writing anything.

`chapter_editor/shared.rs`:
- Add `PreparedRowFileWrite { path, relative_path, original_text: Option<String>,
  updated_text }` and `write_row_files_and_commit(app, repo_path, message, metadata,
  writes)`: preconditions first, then write-all → `git add` → commit; on any failure
  restore originals (or remove created files), `git reset -q --` the paths, and
  return the error. Returns the commit stdout ("" = nothing to commit) so the batch
  command keeps its `commit_sha: None` no-op contract.
- Convert all single- and multi-file mutation commits in `row_fields.rs` and
  `row_structure.rs` (insert passes `original_text: None`) to the helper. The batch
  command and `clear_gtms_editor_reviewed_markers_sync` move to prepare-all-then-
  commit so a mid-loop failure no longer strands earlier writes.
- `permanently_delete_gtms_editor_row_sync` deletes rather than writes: call the
  preconditions check before `fs::remove_file`; on commit failure roll back with
  `git reset -q --` + `git checkout --` (row files are always committed, so HEAD
  has the content).

## m1 — Stale safety comment on the word-count batch helper

Refactor `persist_chapter_source_word_counts_batch` onto `write_row_files_and_commit`
(same pattern, one less bespoke rollback) and rewrite the comment to state the real
hazard: a stranded dirty/staged `chapter.json` breaks later pulls — not "the commit
helper commits everything staged", which has not been true since the helper gained
a pathspec.

## m2 — Deferred

Per-save O(chapter) cost (full row re-read for word counts + linear chapter scan)
needs a design decision — chapter-level count cache or a response-contract change so
saves return deltas. Both touch the frontend contract; out of scope for a findings
branch. Documented as deferred in the review's resolution table.

## Verification

- `cargo test` in `src-tauri` (new unit tests for S1 validation; existing editor
  tests cover the refactored apply/merge paths).
- Manual sanity: editor save/insert/delete against a scratch repo via `tauri:dev`
  is not required for these mechanical transforms; the commit flow is exercised by
  every editor mutation.
