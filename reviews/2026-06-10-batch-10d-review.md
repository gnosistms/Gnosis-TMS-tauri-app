# Code Review — Batch 10d: Chapter Selection + Images
<!-- vt.idd:local-review:batch-10d -->

**Date**: 2026-06-10
**Status**: Review complete. Findings not yet resolved.
**Scope**: chapter-level settings mutations — language selection, language-set edits,
glossary links, workflow status (`chapter_selection.rs`) — and editor row image
save/upload/remove with the shared repo-file snapshot/rollback machinery
(`images.rs`).
**Files**:

| File | Lines | Reviewed? |
|---|---:|---|
| `project_import/chapter_editor/chapter_selection.rs` | 537 | ✅ |
| `project_import/chapter_editor/images.rs` | 1,122 | ✅ (~830 logic, ~290 tests) |
| **Total** | **~1,659** | (session added 2026-06-10; not in the original strategy) |

Also traced (not in batch scope, needed for findings): `project_import.rs` wrappers
(seven commands), `short_path_names::allocate_short_image_filename`,
`constants::ensure_within_import_size_limit`, `git_commit.rs`, and the 10a helpers
(`validated_row_json_path`, `write_row_files_and_commit`).

This is the new session **10d** added during the 10a pass (these two files were missing
from the original strategy). It completes Batch 10.

---

## Executive Summary

| Severity | Count |
|---|---|
| Critical (C) | 0 |
| Security (S) | 1 |
| Major (M) | 1 |
| Minor (m) | 1 |
| **Total** | **3** |

Both files are solid where it counts. `images.rs` is the *model* for the rollback
discipline the rest of Batch 10 had to be brought up to: every image mutation snapshots
the affected files and wraps write+commit in `with_repo_file_rollback`, so a failed
commit never strands a dirty tree — and uploads are validated by magic bytes (not the
client's content type or extension) with the filename sanitized to a safe single
component. `chapter_selection.rs` has careful BCP-47-ish language-code normalization and,
for the heavyweight language-set edit, a clean-tree precondition plus a hard-reset
rollback.

The findings are the now-familiar pair, in the two files the earlier fixes didn't reach.
`images.rs` builds row paths from an unvalidated `row_id` (S1 — the 10a/10b coverage
gap, third and final occurrence), and the three *single-file* chapter.json settings
commits in `chapter_selection.rs` write-then-commit with no rollback (M1).

---

## Preliminary per-batch checks

### Standard V sweep — ✅ clean
All seven commands are `async fn` + `spawn_blocking` wrappers in `project_import.rs`
(image upload decodes/​writes potentially large base64 off the IPC thread). No
synchronous command does I/O.

### Swallowed / non-fatal error pass

| Site | Pattern | Classification |
|---|---|---|
| `images.rs:848-852` — `file_bytes_equal` `.unwrap_or(false)` | `unwrap_or` | Expected — an unreadable/absent file is "not equal", which forces a rewrite. |
| `images.rs:836-844` — `local_file_names` `entry.ok()` | `.ok()` | Expected — skip unreadable dir entries while allocating a unique filename. |
| `images.rs:660-682` — `remove_empty_parent_directories` NotFound/DirectoryNotEmpty arms | match | Correct — tolerant cleanup of now-empty upload folders; real errors still propagate. |
| `chapter_selection.rs:335-340` — rollback formats both error paths | match | Correct — the hard-reset failure is surfaced, not swallowed. |

No site needs a new telemetry event.

### Write-access / permission gating
All mutating commands preflight in the wrapper before the body: the three settings
edits and the language-set edit gate on `ensure_installation_allows_project_management`;
workflow-status and the three image commands gate on `ensure_installation_allows_chapter_writes`.
Repo-level `ensure_repo_allows_writes` still runs inside the commit helper. As in
10b/10c, the early gate narrows but does not close the M1 window (see M1).

---

## Findings

### S1 — `images.rs` builds row paths from an unvalidated `row_id`

**Severity**: Security
**Files**: `images.rs:22-24` (`save_gtms_editor_language_image_url_sync`),
`images.rs:184-186` (`upload_gtms_editor_language_image_sync`),
`images.rs:350-352` (`remove_gtms_editor_language_image_sync`)

All three image commands construct `chapter_path/rows/{row_id}.json` directly from the
client-supplied `input.row_id` — the same pattern 10a S1 fixed in `row_fields`/
`row_structure`/`mod` and 10b S1 fixed in `history.rs`, but `images.rs` is a 10d file and
was in neither change set. A crafted `row_id` with `..` traverses to another chapter's
row, and these commands read, **write, and commit** the resolved path (and on the
URL/remove paths, can also `git rm` a referenced upload), so traversal here is a
read+write+delete primitive. The upload *filename* is correctly sanitized to a safe
single component (`allocate_short_image_filename` → `sanitize_file_component`), so the
image-asset path is not the issue — only the row id is. Same trusted-webview caveat as
the prior two; same fix, and the helper already exists.

| Fix | Description |
|---|---|
| **A ✓** | Route all three sites through `validated_row_json_path(&chapter_path, &input.row_id)` from `shared.rs`. One-line change each. This closes the last occurrence of the row-id traversal pattern in Batch 10. |

### M1 — Chapter settings commits strand a dirty chapter.json when the commit fails

**Severity**: Major
**Files**: `chapter_selection.rs:83-92` (`update_gtms_chapter_language_selection_sync`),
`:388-397` (`update_gtms_chapter_glossary_links_sync`),
`:444-453` (`update_gtms_chapter_workflow_status_sync`)

Each of these three settings edits writes `chapter.json`, `git add`s it, and commits via
`git_commit_as_signed_in_user(_with_metadata)` with no rollback. If the commit fails
(expired session, lost repo write access, git identity), the modified `chapter.json` is
left written and staged, wedging the next pull/rebase — the same write-then-commit shape
fixed in 10a/10b/10c. The blast radius is smaller than those (a single file, not many),
and the wrapper's early installation gate catches the common no-write case, but the
repo/session checks are still late and a single stranded `chapter.json` is enough to
break sync.

Notably the *fourth* mutation in this file — `update_gtms_chapter_languages_sync` — does
this correctly: it refuses to start on a dirty tree (`status --porcelain`) and, on any
failure of its commit+sync sequence, hard-resets to the previous HEAD
(`rollback_failed_chapter_language_update`). The three lighter settings edits just lack
that protection.

| Fix | Description |
|---|---|
| **A ✓** | Route the three single-file commits through the 10a `write_row_files_and_commit` helper (it is file-agnostic — 10c already uses it for `chapter.json`): one `PreparedRowFileWrite` with the current on-disk text as the rollback original. Gates preflight before the write; the file restores and unstages on failure. |
| B | Or capture the original text and `git reset -q --` + restore on commit error. A is preferred for consistency with the rest of Batch 10. |

### m1 — Uploaded SVGs are accepted without sanitization

**Severity**: Minor
**Files**: `images.rs:542-567` (`svg_document_root_is_svg`),
`:596-598` (`detected_uploaded_image_extension` returns `svg`)

Image upload accepts SVG when the XML root element is `<svg>`, but performs no
sanitization — an uploaded SVG can contain `<script>`, `on*` handlers, or
`<foreignObject>` HTML. This is **safe under the current render paths**: HTML export
embeds uploads as `<img src="data:…">` (an image context where SVG scripting does not
execute), and the editor preview likewise loads them as image sources. The risk is
latent: if any surface ever renders an uploaded SVG *inline* into the DOM (not via `img`),
this becomes stored XSS that travels to every teammate via git. Worth either dropping SVG
from the accepted upload set, or running a sanitizer (strip `script`/`foreignObject`/
event attributes) on ingest, and in the meantime a comment pinning the "img-context only"
assumption next to the SVG acceptance.

---

## Observations (not findings)

- **`images.rs` is the rollback reference implementation**: `capture_repo_file_snapshot`
  / `push_repo_file_snapshot` / `with_repo_file_rollback` snapshot disk bytes *and* index
  state and restore both on any failure, including a failed commit — exactly the property
  M1 across this batch was about. The snapshot tests pin restore-bytes and
  remove-when-originally-missing (plus empty-parent-dir cleanup).
- **Upload type validation is magic-byte first** (`detected_uploaded_image_extension`)
  and rejects a filename extension that disagrees with the sniffed content
  (`validated_uploaded_image_extension`) — no trust in client-provided types. Size is
  bounded by `ensure_within_import_size_limit` (25 MB) computed from the base64 length
  before decoding.
- **Filename safety**: `allocate_short_image_filename` runs the IPC filename through
  `sanitize_file_component` (alphanumerics + `-_.` only), truncates, and de-duplicates,
  so an upload can't escape the flat `chapters/<id>/images/` folder.
- **Language-code normalization** (`normalize_chapter_language_code`) canonicalizes
  case/region/script subtags and `_`→`-`, and the selection command validates the chosen
  codes against the chapter's known languages before writing — good input hygiene.
- **`update_gtms_chapter_languages_sync`** is the careful one: clean-tree precondition,
  imported-conflict precondition, commit + remote sync, hard-reset rollback on failure.
  A good template; the M1 fix brings the three lighter edits partway toward it.
- **`validate_editor_image_url`** restricts URL images to `http(s)` schemes; the SSRF
  concern for those URLs at *export* time is the separate 10c S1 (now fixed) — here only
  the scheme is validated, which is appropriate for storage.

---

## Resolution status

| Finding | Status | Notes |
|---|---|---|
| S1 | Open | |
| M1 | Open | |
| m1 | Open | |

---

*Manual review following the Rust Review Strategy, Batch 10 session 4 of 4 (10d — the
session added during 10a for the two files missing from the original strategy). S1 was
verified line-by-line against the three image command bodies; M1 was verified by contrast
with `update_gtms_chapter_languages_sync`'s rollback in the same file; the m1 SVG render
path was traced to `img`/data-URL contexts in `chapter_export.rs`.*
