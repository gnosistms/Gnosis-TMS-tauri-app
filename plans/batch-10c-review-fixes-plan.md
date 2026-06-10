# Batch 10c Review Fixes — Aligned Translation + Export

Resolves the findings from `reviews/2026-06-10-batch-10c-review.md` (S1, S2, M1, m1;
m2 deferred). Branch: `fix/batch-10c-review-findings`. One focused commit per finding.

## S1 — DOCX export SSRF guard + redirect/size caps

`chapter_export.rs::download_docx_image`:
- Build the export client with `redirect::Policy::none()` so a public-looking URL can't
  302 into a private range.
- Parse the URL with `url::Url`; reject non-`http(s)` schemes. Resolve the host with
  `(host, port).to_socket_addrs()` and reject if any resolved address is loopback,
  private, link-local, unspecified, or unique-local (IPv6 ULA `fc00::/7`) — plus reject
  the literal `localhost`. A helper `is_public_export_image_host(url) -> bool`.
- Cap the download: read with a hard byte ceiling (25 MB) via a limited reader instead of
  `response.bytes()` unbounded; abort past it (falls back to the hyperlink render).
- Tests: private/loopback/link-local/ULA hosts rejected; a plain public host passes the
  host check.

## S2 — Validate `job_id` before it reaches the cache path

`aligned_translation.rs`:
- Add `validated_alignment_job_id(&str) -> Result<String, String>` (trim; require
  non-empty single-component `[0-9a-zA-Z_-]`, reject `/`, `\`, `.`, `..`; job ids are
  SHA-256 hex so this is permissive enough).
- `job_path` validates before joining. `apply_*` already passes `input.job_id` straight
  in — the validation in `job_path` covers it; preflight passes the locally computed hash
  (always valid).
- Test: traversal/empty ids rejected, a hex id passes.

## M1 — Apply flows through `write_row_files_and_commit`

`aligned_translation.rs::apply_job_to_chapter`:
- Replace the bespoke write-loop → `git add` → commit (and the manual rollback-less
  staging) with the 10a `write_row_files_and_commit` helper. Build a `PreparedRowFileWrite`
  per changed path: chapter.json (when the target language was added) and each row file
  whose serialized text differs from disk, reading the current on-disk text as the
  rollback `original_text` (created rows have no current file → `original_text: None`).
- Keep the existing "only stage changed files" diffing so an unchanged apply is still a
  no-op. After a successful commit, the `commit_sha` short-rev read and word-count refresh
  are unchanged.
- The helper preflights the write/session gates before the first write and rolls back all
  files + unstages on any failure.

## m1 — Prune the alignment job cache

`aligned_translation.rs`:
- On a successful apply, delete the job file (`fs::remove_file(&job_path)` best-effort)
  so a consumed alignment's cached source/target paste text does not linger.
- Add a best-effort age cap: when writing a new job (`save_job`/preflight), sweep
  `alignment-jobs/` and remove files older than a fixed TTL (e.g. 7 days) so abandoned
  previews are reclaimed. Best-effort, debug-logged on failure, matching the apply-log
  rotation style.

## m2 — Deferred

Per-run API-call/spend budget and bounded concurrency for the section/alignment fan-out
need a UI-facing contract (surfacing a budget, cancellation). Out of scope for a findings
branch; documented as deferred in the review's resolution table (mirrors 10a m2 and the
Batch 9 fan-out observation).

## Verification

- `cargo test --lib` in `src-tauri` (new tests for S1 host checks, S2 id validation;
  existing export/alignment tests cover the refactored apply/render paths).
