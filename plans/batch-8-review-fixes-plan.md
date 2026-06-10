# Batch 8 Review Fixes — Team Metadata

**Status: COMPLETE** — all five fixes implemented and verified; PR #114.

Resolves the five findings from `reviews/2026-06-10-batch-8-review.md` (S1, M1, M2, m1, m2).
Branch: `fix/batch-8-review-findings`. One focused commit per finding.

## S1 — Validate `resource_id` before it reaches `Path::join`

`team_metadata_local/repo.rs`:
- Add `validated_resource_id(&str) -> Result<String, String>`: trim; reject empty;
  reject any char outside `[A-Za-z0-9._-]` (excludes `/`, `\`); reject `.` and `..`.
- `resource_record_path` returns `Result<PathBuf, String>` and routes through it.

Callers updated to `?`: six upsert/delete commands in `team_metadata_local.rs`,
`local_record_has_tombstone` in `records.rs`. Unit tests: traversal ids rejected,
normal ids (uuid-ish, dots, dashes) pass, ids are trimmed.

## m1 — Atomic record writes

`mutations.rs::upsert_local_record`: replace the `create_dir_all` + bare `fs::write`
block with the existing shared atomic helper
`crate::repo_resource_storage::write_text_file` (writes sibling `.tmp`, finalizes via
`util::atomic_replace`, creates parents, already covered by its own regression test).

## M1 — Tolerant record listing + telemetry

- `records.rs::list_local_metadata_records` returns a `TolerantRecordListing<T>`
  (`records: Vec<T>`, `skipped_record_files: Vec<String>` of file stems). Per-file read
  or parse failures are skipped; a directory read failure still hard-fails.
- `github.rs::report_backend_nonfatal_error` becomes `pub(crate)` (the
  `backend-nonfatal-telemetry` event is already routed through `events.js` →
  `telemetry.js` with consent gating; payload stays two `&'static str`s).
- All callers (3 listing commands, `inspect_and_migrate_local_repo_bindings`,
  `repair_local_repo_binding`) use `.records` and emit
  `("team-metadata.records.list", "record_parse_failed")` when anything was skipped.
- Test: temp dir with one valid and one corrupt record file → valid record returned,
  corrupt stem reported.

## M2 — Metadata repo divergence recovery

`repo.rs::pull_local_metadata_repo`: when the `--ff-only` pull fails and the error
indicates divergence ("not possible to fast-forward" / "diverging branches"), retry
with a local `git rebase origin/<branch>` (the pull already fetched; no second network
call). Records are one-file-per-resource, so concurrent edits to different resources
rebase cleanly — the common wedge case self-heals. On rebase failure: reuse
`abort_rebase_after_failed_pull` and return a distinct "has diverged" error.

Frontend `team-metadata-flow.js`: push-conflict / best-effort-sync failures currently
vanish into `console.warn`. Additionally report them through
`telemetry.reportBackendNonfatalError` with stable operation/reason strings (no error
text). A visible "metadata out of sync" UI indicator is out of scope here — with
rebase recovery the wedge self-heals on the next pull; noted as follow-up.

## m2 — Domain-agnostic push gate

`team_metadata_local.rs::push_local_team_metadata_repo`: accept if **any** of
project/glossary/QA-list management is allowed (the push publishes all three domains'
commits), mapping the all-denied case to one clear message.

## Verification

- `cargo test` in `src-tauri` (new unit tests for S1 validation and M1 tolerance).
- `npm test` for the frontend change.
- Manual M2 check with a scratch pair of git repos exercising ff-only failure → rebase
  recovery, since the crate has no git-fixture test harness for pulls.
