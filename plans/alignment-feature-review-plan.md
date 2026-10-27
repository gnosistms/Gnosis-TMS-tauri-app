# Alignment feature code review

Review the current working-tree feature, including the source-corridor changes.
Do not implement fixes during the review.

1. Inspect input/language selection, preflight, candidate generation, reconciliation,
   split validation, and final checks against the documented design.
2. Inspect application, stale-data checks, write serialization, cache/retry behavior,
   and frontend error/progress handling.
3. Reproduce actionable correctness issues with focused, isolated checks; run the
   existing relevant tests. Keep any review-only reproduction outside production.
4. Report prioritized findings with precise source locations and verification limits.

## Completed review

Five actionable findings in the current feature:

- P1: Missing/rejected split output falls back to copying the entire target text
  into every mapped source row (`aligned_translation.rs:1944`). A standalone
  Rust harness executing the extracted production helpers reproduced two copies
  of one paragraph while all final checks passed.
- P1: Apply checks and reads content before taking the repository sync lock
  (`aligned_translation.rs:554`). The lock is first acquired inside
  `shared.rs::write_row_files_and_commit`, after complete replacement JSON has
  been prepared. A sync between those steps can be overwritten by that stale
  snapshot. Confirmed by tracing both apply and background-sync locking; a live
  concurrent sync was not run.
- P2: Apply failures retain `step: applying` (`project-add-translation-flow.js:744`),
  whose renderer is always busy and has no recovery controls. A reproduction
  using the real flow and renderer confirmed that a stale-file error leaves no
  buttons, cancel action, or Escape cancel target.
- P2: The source-unchanged guard compares repository HEAD, so a commit to another
  chapter rejects a valid alignment before comparing source rows
  (`aligned_translation.rs:2042`). Checks should cover the affected chapter's
  relevant inputs while preserving real change detection.
- P2: Completed expensive row passes/conflict decisions are not checkpointed.
  The save after `run_remaining_alignment` is only reached on total success
  (`aligned_translation.rs:461`). A late provider failure forces successful
  alignment/conflict calls to repeat on retry; summary/matching work also lacks
  per-item checkpoints. This falls short of the documented resumable pipeline.

## Validation and limits

- Existing backend alignment tests: 14 passed.
- Existing frontend alignment flow/renderer tests: 21 passed.
- Isolated reproductions: 2 passed, confirming current buggy behavior. Artifacts
  are in `/tmp/gnosis-alignment-review/`; production code was not modified for them.
- Reviewed the current uncommitted corridor change as part of the feature.
- No live AI rerun, app rebuild, or edits to the user's translation data.
- No implementation fixes made during this review.
