# Code Review — Batch 10c: Aligned Translation + Export
<!-- vt.idd:local-review:batch-10c -->

**Date**: 2026-06-10
**Status**: Review complete. Findings not yet resolved.
**Scope**: the "Add translation" AI alignment pipeline — preflight/section/mismatch/
row-alignment/split passes, job caching, and the chapter→rows apply (`aligned_translation.rs`)
— and chapter export to HTML/TXT/DOCX including image embedding and the bundled
OOXML writer (`chapter_export.rs`).
**Files**:

| File | Lines | Reviewed? |
|---|---:|---|
| `project_import/chapter_editor/aligned_translation.rs` | 2,886 | ✅ (~2,000 logic, ~130 tests; rest is types/schemas) |
| `project_import/chapter_editor/chapter_export.rs` | 1,370 | ✅ (~990 logic, ~380 tests) |
| **Total** | **~4,256** | (strategy said ~3,970; files have grown) |

Also traced (not in batch scope, needed for findings): `project_import.rs` wrappers
(`preflight_*`, `apply_*`, `export_*`), `git_commit.rs` (commit-gate placement),
`ai/providers` (`run_prompt`), `storage_paths::installation_data_dir`, and the 10a
helpers (`validated_row_json_path`, `write_row_files_and_commit`).

---

## Executive Summary

| Severity | Count |
|---|---|
| Critical (C) | 0 |
| Security (S) | 2 |
| Major (M) | 1 |
| Minor (m) | 2 |
| **Total** | **5** |

`aligned_translation.rs` is the most algorithmically dense file in the codebase and it
holds up well: the section-window/corridor/row-alignment/split pipeline is resumable
(content-hash-keyed caching per stage), every model response is validated against the
input id space (`validate_alignments` rejects unknown/duplicate/missing target ids),
and the apply path is correctly guarded by `verify_source_unchanged` (commit-sha +
per-row text-hash) so a stale alignment can't be applied. The order-key bulk allocator
and its rebalance fallback respect the F-VII invariants. Export is similarly careful:
an allowlist-based inline-HTML sanitizer, magic-byte image sniffing, and a hand-rolled
but well-tested OOXML/DOCX writer.

The findings are at the edges. The apply path writes N row files + chapter.json then
commits with no rollback if the commit gate fails (M1 — the same pattern fixed in 10a/10b).
Two security items are new to this batch: the DOCX exporter fetches arbitrary image URLs
from row content with no SSRF guard, redirect cap, or size limit (S1), and the apply
command joins a client-supplied `job_id` into a cache path without validation (S2).

---

## Preliminary per-batch checks

### Standard V sweep — ✅ clean
Both commands are `async fn` + `spawn_blocking` wrappers in `project_import.rs`. This
batch is the heaviest in the editor (multiple synchronous OpenAI round-trips in
preflight/apply; a blocking `reqwest` GET per remote image in DOCX export), and all of
it runs off the IPC thread inside `spawn_blocking`. No synchronous command does I/O.

### Swallowed / non-fatal error pass

| Site | Pattern | Classification |
|---|---|---|
| `aligned_translation.rs:2608` — `let _ = app.emit(EVENT_NAME, event)` | `let _ =` | Expected — progress UI notification; loss is cosmetic. |
| `aligned_translation.rs:768-769` — log rotation `let _ = remove_file/rename` | `let _ =` | Expected — best-effort debug-log rotation. |
| `log_alignment_apply_checkpoint` — append failures swallowed (debug eprintln) | `if let Err` | Expected — diagnostic apply log; not user-facing. |
| `aligned_translation.rs:1753` — `fs::read_to_string(&row_path).unwrap_or_default()` | `unwrap_or` | Benign — an unreadable existing row is treated as empty so it gets rewritten; the subsequent write surfaces real errors. |
| `chapter_export.rs:842,849` — `download/read image → unwrap_or_else(Link)` | fallback | Expected by design — an unfetchable image degrades to a hyperlink in DOCX. But see S1: the *fetch itself* is the issue, not the fallback. |
| `run_json_prompt` deserialize failure | `map_err` | Correct — surfaces a clear schema-mismatch error; not swallowed. |

No site needs a new telemetry event.

### Write-access / permission gating
`apply_*` and `preflight_*` preflight `ensure_installation_allows_chapter_writes`
(installation-scoped) in the wrapper before the body runs; the repo-level
`ensure_repo_allows_writes` still runs inside the commit helper. As in 10b, the early
gate catches the common no-write case but the late repo/session checks leave the M1
window open. `export_*` is correctly ungated (it reads the repo and writes to a
user-chosen output path).

---

## Findings

### S1 — DOCX export fetches arbitrary image URLs (SSRF) with no redirect/size cap

**Severity**: Security
**File**: `chapter_export.rs:840-889` (`resolve_docx_image_render` → `download_docx_image`)

When exporting a chapter to DOCX, every `ExportImage::Url` (and any `Upload` whose local
file is missing) triggers a blocking `reqwest` GET to the stored URL so the bytes can be
embedded. The URL comes from row image fields — **content that arrives over git from
other team members**. So a collaborator (or an imported document) can plant an image URL
pointing at the exporting user's loopback/LAN/cloud-metadata endpoint
(`http://169.254.169.254/…`, `http://192.168.…`, `http://localhost:…`), and the victim's
machine issues that request the moment they export. Compounding factors:

- **No redirect policy** — `reqwest::blocking` follows up to 10 redirects by default, so
  an allowed-looking public URL can 302 into the internal range.
- **No response size limit** — `response.bytes()` (`:881`) buffers the whole body into
  memory; a hostile or accidental large URL is an unbounded allocation.
- The fetched bytes are only *embedded* if they sniff as PNG/JPEG/GIF, but the **request
  still happens** regardless, which is the SSRF — and timing/connectivity differences are
  observable.

This is a desktop app fetching on the user's own network, and the user did configure
their own document — but the cross-user git vector (someone else's row content causing
*your* machine to probe *your* internal network on export) takes it outside the F-VIII
"local attacker against their own machine" scope. F-VIII is about at-rest key storage,
not outbound requests, so this is a genuine new finding, not a re-litigation.

| Fix | Description |
|---|---|
| **A ✓** | Before fetching, resolve the host and reject non-public targets: literal loopback/private/link-local/ULA IPs and `localhost`. Set `redirect::Policy::none()` (or a 1–2 hop cap that re-checks each hop) on the export client. |
| **B ✓** | Cap the download: stream with a hard byte ceiling (e.g. 25 MB) and abort past it, instead of `response.bytes()` unbounded. |
| C | Consider gating remote-image *fetching* behind an explicit opt-in, defaulting DOCX to the hyperlink fallback for `Url` images (HTML export already just emits the `src` without fetching). |

### S2 — `job_id` from IPC is joined into a cache path without validation

**Severity**: Security
**File**: `aligned_translation.rs:2611-2616` (`job_path`), reached from
`apply_aligned_translation_to_gtms_chapter_sync` (`:490-491`)

`apply_*` takes `input.job_id` straight from IPC and builds
`installation_data_dir/alignment-jobs/{job_id}.json`, then `read_json_file`s it. Nothing
rejects path separators or `..`, so a crafted `job_id` (e.g. `../../something`) resolves
and reads an arbitrary `*.json` outside the alignment-jobs dir. The blast radius is
smaller than the 10a/10b row cases — it is a **read** that must then deserialize as an
`AlignmentJob`, and `verify_source_unchanged` later re-checks against disk — but the file
read happens before any of that, and `job_path` also `create_dir_all`s a directory
derived from the joined path. Normal `job_id`s are SHA-256 hex (`hash_json`), so a strict
check costs nothing. Same posture as the Batch 8/10a/10b id-validation fixes.

| Fix | Description |
|---|---|
| **A ✓** | Validate `job_id` as hex (the ids are `hash_json` SHA-256 → `^[0-9a-f]{64}$`, or a permissive `[0-9a-zA-Z_-]+` single-component check) at the top of `apply_*` and in `job_path`, returning `Result`. |

### M1 — Apply writes rows + chapter.json then commits with no rollback

**Severity**: Major
**File**: `aligned_translation.rs:1729-1810` (`apply_job_to_chapter`)

The apply path writes the updated/inserted row files and (when a new target language is
added) `chapter.json` to disk, `git add`s them, and commits via
`git_commit_as_signed_in_user_with_metadata` — the same *write-then-commit, gate-runs-late*
shape that 10a M1 and 10b M1 fixed. If the commit fails (expired session, lost repo write
access, git identity, or a mid-loop write error), the written files are left on disk and
staged, wedging the next pull/rebase. The wrapper's early
`ensure_installation_allows_chapter_writes` narrows the common case (as in 10b) but the
repo/session checks are still late, and this path mutates *many* files (every reordered
row on a rebalance, every inserted row, plus chapter.json), so a partial failure is the
worst-case of the three M1s.

| Fix | Description |
|---|---|
| **A ✓** | Route the staged writes through the 10a `write_row_files_and_commit` helper: build a `PreparedRowFileWrite` per changed path (row files + chapter.json), reading each current on-disk text as the rollback original, and let the helper preflight the gates, write-all, commit, and roll back on any failure. The `commit_sha`/word-count refresh after a successful commit is unchanged. |
| B | If keeping the bespoke loop, capture originals and `git reset -q --` + restore on commit error, matching `persist_chapter_source_word_counts_batch`. A is strongly preferred for consistency with the other two batches. |

### m1 — Cached alignment jobs (with pasted document text) are never pruned

**Severity**: Minor
**File**: `aligned_translation.rs:2611-2628` (`job_path` / `save_job`)

Each preflight writes `alignment-jobs/{job_id}.json` containing the full `source_units`
and `target_units` — i.e. the chapter's source text and the user's pasted translation —
and these files are never deleted (only the apply checkpoint log rotates). Over time this
accumulates plaintext document content on disk, one file per distinct alignment attempt.
Local-first means content on disk is expected, but an unbounded, never-cleaned cache of
*paste payloads* is worth bounding — prune on successful apply, and/or age/size-cap the
`alignment-jobs` directory the way the apply log is rotated.

### m2 — Pipeline cost is unbounded and serial with no per-call budget

**Severity**: Minor
**File**: `aligned_translation.rs` (`summarize_sections`, `find_section_matches`,
`align_rows`, `resolve_row_candidate_conflicts`, `split_targets`)

A large chapter fans out into many serial OpenAI calls: one summary per source+target
section, one match call per target section, one alignment call per corridor pair, one
extra call per row-alignment conflict, plus a split pass. There is no overall ceiling on
call count or spend and no parallelism — a big paste can run for minutes and an unbounded
number of API calls, with cancellation only via the job not being re-applied. Resumability
(stage caching) softens repeated runs, but a first run on a long chapter is open-ended.
Consider a call-count/words budget surfaced to the UI, or bounded concurrency for the
independent per-section calls. (Mirrors the Batch 9 glossary-alignment fan-out
observation.) Not a correctness bug.

---

## Observations (not findings)

- **Model-response validation is strict and good**: `validate_alignments` rejects unknown
  target ids, duplicate target ids, unknown source ids, and missing targets;
  `validate_split_response` only accepts fragments that are exact substrings of the target
  text (`find_fragment_range`) and that fully cover it (`split_covers_target`). The model
  is never trusted to invent ids or text.
- **`verify_source_unchanged`** gates apply on both the chapter base commit sha and a
  per-row `(row_id, text_hash)` comparison — a solid optimistic-concurrency check that
  prevents applying an alignment computed against since-changed source rows.
- **Order-key allocation** (`allocate_bulk_order_keys` + `build_rebalanced_bulk_insertion_plan`
  + `rebalanced_order_key`) keeps the 32-char lowercase hex / lexicographic F-VII invariant,
  detects exhausted gaps, and falls back to a full rebalance — careful work, well tested.
- **Inline-HTML sanitizer is allowlist-based** (`allowed_inline_tag`: only b/strong, i/em,
  u, ruby, rt) and everything else is entity-escaped, so export can't smuggle arbitrary
  markup/script into HTML/DOCX. The DOCX writer escapes XML on every run/text node.
- **Image type sniffing** uses magic bytes first and only falls back to extension, and the
  DOCX path embeds only PNG/JPEG/GIF (with real dimension parsing) — no reliance on
  client-provided content types.
- **`apply_job_to_chapter` skips non-empty target rows** (`fillEmptyOnly` is the only
  supported write mode, enforced at `:487`), so apply is non-destructive to existing
  translations by construction.
- **Duplicate-language code allocation** (`next_duplicate_language_code`) scans both the
  language list and every row's field codes, so a reused base code lands on `…-x-N` without
  colliding with inactive field data — the tests pin this.
- The DOCX `download_docx_image` 8s timeout is reasonable; the gap is the missing
  SSRF/redirect/size controls (S1), not the timeout.

---

## Resolution status

| Finding | Status | Notes |
|---|---|---|
| S1 | Open | |
| S2 | Open | |
| M1 | Open | |
| m1 | Open | |
| m2 | Open | |

---

*Manual review following the Rust Review Strategy, Batch 10 session 3 of 4 (10c). The
M1 gate placement was verified against `git_commit.rs` and the wrapper in
`project_import.rs`; the S1 SSRF surface was traced from row image content through
`resolve_docx_image_render` → `download_docx_image`; reqwest's default 10-redirect
follow behavior was the basis for the redirect note.*
