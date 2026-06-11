# Code Review — Batch 11a: Import Core + Chapter Lifecycle
<!-- vt.idd:local-review:batch-11a -->

**Date**: 2026-06-10
**Status**: Complete. All six findings resolved on `fix/batch-11a-review-findings`.
**Scope**: the `project_import` command surface (all 40+ async wrappers), the shared
project-git helper layer (`project_git.rs`), URL/Google-Docs link resolution
(`link_import.rs`), chapter rename/soft-delete/restore/permanent-delete
(`chapter_lifecycle.rs`), and editor row comments (`chapter_editor_comments.rs`).
**Files**:

| File | Lines | Reviewed? |
|---|---:|---|
| `project_import.rs` | 649 | ✅ |
| `project_import/project_git.rs` | 210 | ✅ (~199 logic, ~11 tests) |
| `project_import/link_import.rs` | 440 | ✅ (~383 logic, ~57 tests) |
| `project_import/chapter_lifecycle.rs` | 466 | ✅ (~364 logic, ~102 tests) |
| `project_import/chapter_editor_comments.rs` | 532 | ✅ (~438 logic, ~94 tests) |
| **Total** | **~2,297** | |

Also traced (not in batch scope, needed for findings): `chapter_editor/shared.rs`
(`validated_row_json_path`, `write_row_files_and_commit`), `chapter_editor/chapter_selection.rs`
(`commit_chapter_json_update`), `chapter_editor/chapter_export.rs` (the 10c download caps),
`git_commit.rs` (`ensure_local_commit_preconditions`), `constants.rs`
(`ensure_within_import_size_limit`), and the `git_output_with_stdin` call sites in
`images.rs`/`history.rs`.

---

## Executive Summary

| Severity | Count |
|---|---|
| Critical (C) | 0 |
| Security (S) | 1 |
| Major (M) | 2 |
| Minor (m) | 3 |
| **Total** | **6** |

The command wrapper layer (`project_import.rs`) is uniformly correct: every command is
`async` + `spawn_blocking`, and the mutation gates are consistently preflighted
(project-management gate for chapter lifecycle/settings, chapter-writes gate for row and
comment mutations). `chapter_lifecycle.rs` has good idempotency instincts — same-title
rename and same-state lifecycle updates short-circuit without a commit, and permanently
deleting an already-missing chapter succeeds quietly. `link_import.rs` validates schemes,
caps redirects, sniffs DOCX/XLSX by magic bytes, and sanitizes server-supplied filenames.

The two headline findings are the *same two patterns Batch 10 closed out*, present in the
two files that predate those fixes and were never brought along. `chapter_editor_comments.rs`
builds row paths from an unvalidated `row_id` (S1 — fourth occurrence of the 10a pattern)
and, together with every mutation in `chapter_lifecycle.rs`, writes (or deletes) and then
commits with no rollback (M1 — the 10a–10d M1 pattern; the destructive delete variants are
the worst shape of it). Both fixes already exist as shared helpers; this is routing work.
The genuinely new finding is M2: link import buffers an unbounded remote response into
memory *before* checking the 25 MB limit.

---

## Preliminary per-batch checks

### Standard V sweep — ✅ clean

The mechanical grep finds **no** synchronous `#[tauri::command]` in the batch files. All
commands in `project_import.rs` are `async fn` wrappers around
`tauri::async_runtime::spawn_blocking`, including the network-bound
`resolve_project_import_link` and the only non-I/O command
(`cancel_project_import_batch`, a mutex insert — fine either way).

### Swallowed / non-fatal error pass

| Site | Pattern | Classification |
|---|---|---|
| `chapter_editor_comments.rs:19` — `current_repo_head_sha` `.ok()` | `.ok()` | Expected — the head sha is an optional response field; a missing HEAD just omits it. |
| `link_import.rs:87-96,141-143` — header value parsing `unwrap_or("")` etc. | `unwrap_or` | Expected — tolerant header handling with explicit fallbacks. |
| `link_import.rs:178` — `Client::builder()…build().unwrap_or_else(\|_\| Client::new())` | `unwrap_or_else` | Defect-adjacent — the fallback silently drops the 30 s timeout and redirect cap, and `Client::new()` panics on the same underlying failure anyway. Propagate the builder error instead (folded into Observations; no telemetry needed). |
| `chapter_lifecycle.rs:74,243,308` — lifecycle state `unwrap_or("active")` | `unwrap_or` | Expected — a missing `lifecycle` object means active by schema default. |
| `chapter_editor_comments.rs:411-415` — delete scan skips unparseable comment entries | `.ok()`/`unwrap_or(false)` | Expected — a malformed entry can't match the target id; the command then fails with a clear "could not find that comment". |
| `chapter_lifecycle.rs:440,463` — `let _ = fs::remove_dir_all` | `let _ =` | Test-only cleanup. |

No site needs a new telemetry event, with one exception folded into m2 (tolerant
chapter.json listing *should* emit one if adopted).

### Write-access / permission gating

Consistent and correct at the wrapper layer: `rename`, `soft_delete`/`restore`/
`permanently_delete_gtms_chapter`, and `clear_deleted_gtms_chapters` preflight
`ensure_installation_allows_project_management`; `save`/`delete_gtms_editor_row_comment`
preflight `ensure_installation_allows_chapter_writes`; read-only commands
(`load_gtms_editor_row_comments`, `resolve_project_import_link`) are correctly ungated.
Repo-level `ensure_repo_allows_writes` and the session check still run only inside the
commit helper — which is exactly the M1 window.

---

## Findings

### S1 — `chapter_editor_comments.rs` builds row paths from an unvalidated `row_id`

**Severity**: Security
**Files**: `chapter_editor_comments.rs:284-291` (`resolve_row_json_path`), reached from
all three comment commands (`load_gtms_editor_row_comments_sync`,
`save_gtms_editor_row_comment_sync`, `delete_gtms_editor_row_comment_sync`)

`resolve_row_json_path` joins `rows/{row_id}.json` directly from the client-supplied
`input.row_id` — the identical pattern fixed in 10a (`row_fields`/`row_structure`/`mod`),
10b (`history.rs`), and 10d (`images.rs`). This module is a *sibling* of `chapter_editor`
and was in none of those change sets, so it is now the only remaining occurrence. A
crafted `row_id` with `..` escapes the chapter's `rows/` folder; the load command turns
that into an arbitrary-JSON read (any file that parses as JSON, with serde defaults
filling the comment fields), and the save/delete commands **read, modify, write, and
commit** the resolved path — a write primitive against any JSON file in (or above) the
repo. Same trusted-webview caveat as the prior occurrences; same one-line fix.

| Fix | Description |
|---|---|
| **A ✓** | Route `resolve_row_json_path` through `validated_row_json_path` from `chapter_editor/shared.rs`. The helper is `pub(super)` inside `chapter_editor`; re-export it through `chapter_editor/mod.rs` (the module already re-exports a dozen items to `project_import.rs`). This closes the last row-id traversal site in the codebase. |

### M1 — Every mutation in `chapter_lifecycle.rs` and `chapter_editor_comments.rs` writes (or deletes) and then commits with no rollback

**Severity**: Major
**Files**: `chapter_lifecycle.rs:195-205` (rename), `:253-263` (lifecycle state),
`:314-329` (permanent delete: `git rm -r` + `fs::remove_dir_all`, then commit),
`:337-358` (clear deleted: a *loop* of `git rm -r` + `remove_dir_all`, then one commit);
`chapter_editor_comments.rs:186-201` (save comment), `:258-273` (delete comment)

All six mutations in this batch share the write-then-commit shape that 10a–10d
eliminated from the chapter editor: modify the working tree, `git add`, then call the
commit helper — whose write-access and signed-in-session checks run *last*. A failed
commit (expired session, lost repo write access, missing git identity) strands a dirty,
staged working tree that wedges the next pull/rebase.

Two of the sites are the worst variant of the pattern reviewed so far, because the
pre-commit mutation is **destructive**: permanent delete and clear-deleted stage the
removal *and delete the chapter folders from disk* before any commit gate runs. The
content is recoverable from HEAD (soft-deleted chapters are committed state), but a
failed commit leaves staged deletions plus missing folders — and in `clear_deleted`, a
mid-loop failure (e.g. one unreadable folder) leaves a *partially* cleared, uncommitted
tree. Any uncommitted local edit inside a deleted chapter folder is lost outright.

The fixes already exist:

| Fix | Description |
|---|---|
| **A ✓** (chapter.json writes) | Route rename and lifecycle-state updates through the 10d `commit_chapter_json_update` helper (currently private to `chapter_selection.rs` — move it to a shared location, e.g. `chapter_editor/shared.rs`, or duplicate the 4-line body over `write_row_files_and_commit`). Gates preflight before the write; the file restores and unstages on failure. |
| **A ✓** (row comment writes) | Route comment save/delete through `write_row_files_and_commit` with one `PreparedRowFileWrite` (the `original_row_text` both functions already hold is the rollback original). |
| **A ✓** (destructive deletes) | Call `ensure_local_commit_preconditions(app, repo_path)` *before* the first `git rm`/`remove_dir_all` (this alone closes the common failure modes), and on a commit error restore with `git reset -q -- <paths>` + `git checkout -q -- <paths>` so the staged deletions and missing folders roll back to HEAD. |

### M2 — Link import buffers an unbounded remote response before the size check

**Severity**: Major
**Files**: `link_import.rs:97-100` + `:114-115` (`resolve_google_export`),
`:144-147` + `:162-163` (`resolve_html_link`)

Both fetch paths call `response.bytes()` — reading the **entire** body into memory —
and only then call `ensure_within_import_size_limit` on the resulting length. The 25 MB
limit therefore bounds nothing: a hostile or simply huge endpoint can stream as much as
the 30-second timeout allows (hundreds of MB to multiple GB on a fast connection) into
the worker's heap before the check rejects it. The full buffer is then potentially
base64-encoded on top. 10c hit the same issue at export and fixed it with a streaming
cap; the same transform applies here.

| Fix | Description |
|---|---|
| **A ✓** | Mirror `download_docx_image` (`chapter_export.rs:896-900`): `let mut limited = response.take(MAX_IMPORT_FILE_BYTES + 1); limited.read_to_end(&mut data)`, then reject with the existing `import_file_size_limit_error` message when `data.len() as u64 > MAX_IMPORT_FILE_BYTES`. Apply to both fetch paths. |

### m1 — `percent_decode_utf8_lossy` can panic on multibyte input from a remote header

**Severity**: Minor
**Files**: `link_import.rs:312-328`, reached from `decode_rfc5987_file_name` ←
`content_disposition_file_name` ← the Google export `Content-Disposition` header

The decoder indexes the *string* by byte offsets derived from scanning *bytes*:
`&value[index + 1..index + 3]` panics when `index + 3` falls inside a multibyte UTF-8
character — e.g. the input `%aé` (a `%` whose two following bytes are an ASCII char and
the first byte of a two-byte char). The input is a server-controlled `filename*`
parameter, so a malformed or malicious header can trigger the panic. Impact is bounded —
the panic unwinds the `spawn_blocking` worker and surfaces as "The link import worker
failed: …" — but it violates the no-panic convention and turns a salvageable header
into a failed import. Fix: do the hex parse over the byte slice
(`std::str::from_utf8(&bytes[index + 1..index + 3]).ok().and_then(…)`) or guard with
`value.is_char_boundary`.

### m2 — One corrupt `chapter.json` wedges every chapter-id lookup in the repo

**Severity**: Minor
**Files**: `project_git.rs:188` (`find_chapter_path_by_id`), same shape at
`chapter_lifecycle.rs:107` (`clear_deleted_chapters_in_repo`)

`find_chapter_path_by_id` scans every chapter folder and propagates a `read_json_file`
error from *any* of them — so a single truncated or hand-edited `chapter.json` (crash
mid-write, conflict leftovers) makes rename, soft-delete, restore, permanent delete, and
all comment operations fail for **every** chapter in the project, with an error about a
chapter the user didn't touch. Batch 8 fixed the same shape with tolerant record listing
plus telemetry. Recommend: skip unreadable/unparseable `chapter.json` files during the
scan (the target chapter, if intact, is still found) and emit a small Tauri event routed
through `src-ui/app/telemetry.js` — stable operation name (e.g.
`chapter-scan-skipped-invalid-json`) and a scrubbed error string, no paths or content.
This is a non-fatal defect signal, not expected control flow, so it qualifies under the
every-batch telemetry rule.

### m3 — `git_output_with_stdin` can deadlock on large request/response pairs

**Severity**: Minor
**Files**: `project_git.rs:77-121`; call sites `images.rs:825` and `history.rs:823`
(`git cat-file --batch`)

The helper writes the **entire** stdin payload with `write_all` before calling
`wait_with_output`. With `cat-file --batch`, git consumes a request line and writes the
object before reading the next line — so once git's stdout pipe fills (~64 KB) git
blocks writing, stops reading stdin, our stdin pipe fills, and `write_all` blocks
forever: a classic two-pipe deadlock, surfacing as a permanently hung command (worse
than an error — no rejection ever reaches `runtime.js`). Reachable when the request
exceeds the pipe buffer (~1,000+ row requests) while the early objects exceed ~64 KB of
output — i.e. exactly the very large chapters where the batch APIs matter. Fix: write
stdin from a spawned thread (drop the handle to close the pipe), then
`wait_with_output`; or chunk requests below the pipe-buffer bound.

---

## Observations (not findings)

- **`link_import` SSRF posture is acceptable for its current trust model**: the URL is
  typed/pasted by the local user and the fetched content returns only to that user —
  equivalent to a browser visit. This is materially different from 10c, where URLs
  arrived over git from other users. If link-import URLs are ever stored and re-fetched
  automatically (or fetched on another member's machine), the 10c guard
  (`validated_export_image_request`: public-host check, no redirects, DNS pinning) must
  be applied. A comment pinning that assumption would be cheap insurance.
- **Filename hygiene in `link_import` is good**: `sanitize_file_name` strips path
  separators and reserved characters from server-supplied names, RFC 5987 names are
  handled, and `slugify_file_stem` keeps generated HTML names to `[a-z0-9-]`.
- **Google export validation is layered sensibly**: status/redirect-host/body
  heuristics for access denial, then a `PK` magic-byte check so an HTML interstitial
  can't masquerade as DOCX/XLSX.
- **Idempotency in `chapter_lifecycle`**: no-op rename and no-op lifecycle transitions
  return without committing; permanent delete of an already-missing chapter succeeds.
  The latter is implemented by string-equality matching on the exact
  `find_chapter_path_by_id` error message (`chapter_lifecycle.rs:286-293`) — brittle;
  a typed not-found (e.g. `Option` return) would survive message edits.
- **`find_chapter_path_by_id` is O(chapters) with a full JSON parse per folder, per
  command** — every comment save scans all chapters. Echoes the 10a m2 scale concern;
  fine at current scale, worth an id→folder index if chapter counts grow.
- **Comment author authorization is advisory** (`delete_editor_comment` compares the
  stored `author_login` to the local session login): anyone with repo write access can
  edit row files directly, so this is UX enforcement, not a security boundary —
  consistent with the app's trust model, and correctly enforced in Rust rather than
  only in the UI.
- **Tests are well-aimed**: clear-deleted covers the only-deleted/none-deleted matrix
  against a real git repo; comments cover defaults, append/delete revision bumps, and
  the non-author rejection.

---

## Resolution status

| Finding | Status | Notes |
|---|---|---|
| S1 | Resolved | `resolve_row_json_path` routes through `validated_row_json_path`, re-exported from `chapter_editor` (the helper and `write_row_files_and_commit`/`PreparedRowFileWrite` were widened to `pub(in crate::project_import)` for the sibling modules). |
| M1 | Resolved | Comment save/delete flow through `write_row_files_and_commit`; rename and lifecycle-state updates flow through `commit_chapter_json_update` (moved from `chapter_selection.rs` into `shared.rs`); permanent delete and clear-deleted preflight `ensure_local_commit_preconditions` before the first destructive step and roll back staged removals (`git reset` + `git checkout` from HEAD) on commit or mid-sequence failure, with a test pinning the restore. |
| M2 | Resolved | Both link-import fetch paths read at most `MAX_IMPORT_FILE_BYTES + 1` via `Read::take` (the 10c transform); the existing size checks reject the overflow byte. |
| m1 | Resolved | The hex pair is parsed from the byte slice; tests cover multibyte names, a `%` adjacent to raw UTF-8, and truncated escapes. |
| m2 | Resolved | `find_chapter_path_by_id` skips unreadable chapter.json files (telemetry: `project-import.chapter-scan` / `chapter_json_read_failed`); clear-deleted skips them and leaves the folders untouched; permanent delete uses a typed `try_find_chapter_path_by_id` instead of the brittle error-string match (also closing that observation). Tests cover both scan and clear paths. |
| m3 | Resolved | `git_output_with_stdin` writes stdin from a spawned thread while `wait_with_output` drains the pipes; git's own error is preferred over a stdin write error. |

---

*Manual review following the Rust Review Strategy, Batch 11 session 1 of 3. S1 was
verified against all three comment command bodies and contrasted with the 10a/10b/10d
fixes; M1 against `write_row_files_and_commit` / `commit_chapter_json_update`; M2 against
the 10c streaming cap in `download_docx_image`; m1 by byte-offset analysis of the
`%`-decode loop; m3 against the `cat-file --batch` call sites in `images.rs`/`history.rs`.*
