# Batch 10b Review Fixes — Git Conflicts + History

**Status: complete (2026-06-10).** All four findings landed on
`fix/batch-10b-review-findings`. m2 was implemented as the review's option A
(proper comment merge), not the interim option B.

Resolves the findings from `reviews/2026-06-10-batch-10b-review.md` (S1, M1, m1, m2).
Branch: `fix/batch-10b-review-findings`. One focused commit per finding.

## S1 — Route history row paths through `validated_row_json_path`

`history.rs`: the two `chapter_path/rows/{row_id}.json` constructions
(`load_gtms_editor_field_history_sync`, `restore_gtms_editor_field_from_history_sync`)
switch to the existing `validated_row_json_path` from `shared.rs` — the coverage gap
left by the 10a S1 fix. No new helper needed.

## M1 — Batch-replace undo flows through `write_row_files_and_commit`

`history.rs::reverse_gtms_editor_batch_replace_commit_sync`: stop writing row files
inside the scan loop. Collect a `PreparedRowFileWrite` per restored row
(`original_text` = the current on-disk text already read for the no-op comparison),
then hand the whole set to the 10a `write_row_files_and_commit` helper — preflighted
gates, write-all, add, commit, full rollback on any later failure. Word counts move
to the prepared (not yet written) rows, so they are computed from the restored texts
the same way as before via the response building after the commit succeeds.

## m1 — Validate IPC `commit_sha` as a hex object id

`history.rs`: add `validated_commit_sha(&str) -> Result<&str, String>` (trim; require
7–64 ascii-hex chars) and call it at the top of `restore_*` and `reverse_*` before any
git invocation, so a `-`-leading or junk value can never reach `git show`/`rev-parse`/
`log` argument positions. Unit tests: hex shas pass (short + full), option-looking and
non-hex values are rejected.

## m2 — Merge editor comments in the semantic row merge

`git_conflicts.rs`: `editor_comments` / `editor_comments_revision` were outside the
supported merge set, so a local-only comment on a row the remote also edited aborted
the entire semantic resolution ("unsupported local-only changes remain"). Fix per the
review's option A (proper merge — option B's silent comment drop is data loss for a
review tool):

- `strip_supported_row_merge_keys` also strips `editor_comments` and
  `editor_comments_revision` so they no longer trip the unsupported check.
- New `merge_editor_comment_slices(base, local, remote)` (Value-based; the typed
  struct's fields are private to `chapter_editor_comments`): keep remote's comments
  in remote order, dropping ones deleted locally (in base, missing from local);
  append local-only additions (not in base, not in remote). An edited comment takes
  the remote version, consistent with the scalar rule. Revision =
  `max(local, remote)`, `+1` when both sides changed comments relative to base, so
  either client computing the merge independently lands on the same value and caches
  invalidate.
- Apply the merged list + revision to both the on-disk (remote) and journaled (local)
  row values, like the other slices.
- Tests: local comment + remote text edit resolves with both preserved; local
  deletion is honored against an unchanged remote; concurrent additions union with a
  bumped revision.

## Verification

- `cargo test --lib` in `src-tauri` (new tests for m1 validation and the m2 comment
  merge; existing conflict tests pin the unchanged rules).
