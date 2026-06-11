# Code Review — Batch 11b: HTML Import
<!-- vt.idd:local-review:batch-11b -->

**Date**: 2026-06-10
**Status**: Complete. All four findings resolved on `fix/batch-11b-review-findings`.
**Scope**: the shared import-pipeline plumbing — input/response types, the per-format
dispatch, batch import with cancellation and cleanup (`chapter_import/mod.rs`) — and the
HTML reader-extraction parser: readability + fallback article extraction, block/style
mapping, and image resolution across URL, data-URI, and local-file sources (`html.rs`).
**Files**:

| File | Lines | Reviewed? |
|---|---:|---|
| `project_import/chapter_import/mod.rs` | 1,217 | ✅ (~730 logic, ~490 tests) |
| `project_import/chapter_import/html.rs` | 1,305 | ✅ (~955 logic, ~350 tests) |
| **Total** | **~2,522** | |

Also traced (not in batch scope, needed for findings): `write_gtms.rs` — the chapter
write/commit flow (`import_parsed_workbook_to_gtms_sync`, `write_parsed_workbook_chapter`,
`commit_written_imports`) and pending-upload image finalization
(`finalize_pending_uploaded_images`, `detected_imported_image_extension`) — plus
`short_path_names.rs` allocation helpers, `constants.rs` size limits, and the 10d-era
`images.rs` upload validation for parity comparison. `write_gtms.rs` remains in 11c scope;
only the surfaces reachable from this batch's flows were reviewed here.

---

## Executive Summary

| Severity | Count |
|---|---|
| Critical (C) | 0 |
| Security (S) | 0 |
| Major (M) | 1 |
| Minor (m) | 3 |
| **Total** | **4** |

The strategy flagged this batch as the main adversarial-input surface, and the parser
holds up well. Parsing is html5ever-based (no hand-rolled tag scanning on the hot path),
image sources are scheme-allowlisted (`javascript:`/`blob:` rejected, `file:` and
relative paths confined to the dropped HTML's own folder via canonicalize +
`starts_with`), embedded data-URI images are size-checked from the *base64 length before
decoding* and validated by magic bytes after, and every generated folder/file name flows
through the sanitizing `short_path_names` allocators. Chapter slugs, row files, and
image filenames cannot escape the repo. Zero Security findings.

The Major is this batch's instance of the now-familiar pattern: the **single-file**
import commands (XLSX/TXT/DOCX/HTML) write the chapter and then commit with no cleanup
on commit failure — and because `prepare_project_import_repo` refuses to start on a
dirty tree, one failed commit wedges *all future imports*. The batch path already has
exactly the right cleanup; the single-file path just doesn't use it. The minors: the
import pipeline still accepts SVG through its own copy of the XML sniffer that 10d
removed from the editor upload path; the batch path's cleanup can shadow the original
import error; and the alignment-marker matcher is quadratic, letting a crafted page pin
an import worker for hours.

---

## Preliminary per-batch checks

### Standard V sweep — ✅ clean

Neither file defines a `#[tauri::command]`; all entry points are the `async` +
`spawn_blocking` wrappers in `project_import.rs`, enumerated and verified in the 11a
review. Mechanical grep over `chapter_import/` confirms no command attributes.

### Swallowed / non-fatal error pass

| Site | Pattern | Classification |
|---|---|---|
| `mod.rs:535` — `emit_batch_progress` `let _ = app.emit(…)` | `let _ =` | Expected — optional UI progress notification. |
| `mod.rs:688` — cleanup `let _ = git reset -- path` | `let _ =` | Expected — best-effort unstage during cleanup; removal errors *are* aggregated below it. |
| `mod.rs:693-700` — cleanup `remove_dir_all` tolerated when the path is already gone | match | Correct — only reports when the folder still exists. |
| `html.rs:740-763` — `canonicalize().ok()` / `fs::read().ok()` in local image resolution | `.ok()` | Expected — an unresolvable or unreadable local image degrades to "no image for this block", which is the right import behavior. |
| `html.rs:158` — `Readability::new(…)` failure falls through to `fallback_article` | `if let Ok` | Expected — the fallback extractor is the designed second path. |
| `html.rs:704` — base64 decode failure → image skipped | `.ok()` | Expected — malformed data URI is not an importable image. |
| `write_gtms.rs:163-167` — chapter-write failure cleanup `let _ = remove_dir_all` | `let _ =` | Expected — best-effort cleanup that *preserves* the original error (contrast m2). |

No site needs a new telemetry event.

### Write-access / permission gating

All import commands preflight `ensure_installation_allows_project_management` in the
`project_import.rs` wrappers (verified in 11a); repo-level write access and the session
check run inside `git_commit_as_signed_in_user_with_metadata`. As elsewhere, those
repo/session checks run *after* the files are written — which is M1's window.

---

## Findings

### M1 — Single-file imports strand a written, staged chapter when the commit fails — and the clean-tree precondition then wedges every future import

**Severity**: Major
**Files**: `write_gtms.rs:44-63` (`import_parsed_workbook_to_gtms_sync`),
`write_gtms.rs:173-196` (`commit_written_imports`), `write_gtms.rs:78-81`
(`ensure_clean_git_repo` precondition in `prepare_project_import_repo`); contrast
`mod.rs:488-503` (batch path) and `mod.rs:674-718` (`cleanup_written_imports`)

The four single-file import commands (`import_xlsx/txt/docx/html_to_gtms`) flow through
`import_parsed_workbook_to_gtms_sync`: write the chapter folder, then
`commit_written_imports` (`git add` + commit). If the commit fails — expired session,
lost write access, git identity — the chapter folder stays on disk and **staged**, and
nothing cleans it up. `write_parsed_workbook_chapter` does clean up its own *internal*
failures (closure + `remove_dir_all` + conditional `.gitattributes` removal), so the
gap is exactly the commit step.

What elevates this above the generic dirty-tree problem: `prepare_project_import_repo`
*requires a clean tree* ("The local project repo has uncommitted changes. Sync it
before adding files."), so after one failed commit, **every subsequent import fails**
with a message about changes the user never made. The batch path
(`import_project_files_to_gtms_sync`) already handles this exact case — on commit
failure it calls `cleanup_written_imports` (unstage + remove folders + restore
`.gitattributes`). The single-file path predates that and was never brought along.

| Fix | Description |
|---|---|
| **A ✓** | On `commit_written_imports` failure in `import_parsed_workbook_to_gtms_sync`, run the same cleanup as the batch path (move `cleanup_written_imports` into `write_gtms.rs` or call across; it is context+written-based and fits as-is). Additionally preflight `ensure_local_commit_preconditions(app, &repo_path)` in `prepare_project_import_repo` so the *expected* gate failures (degraded access, signed-out) reject before anything is parsed or written — same shape as 11a M1's destructive-delete fix. |

### m1 — The import image pipeline still accepts SVG through its own copy of the sniffer 10d removed

**Severity**: Minor
**Files**: `write_gtms.rs:543-545` (`detected_imported_image_extension` returns `svg`),
`write_gtms.rs:550-574` (`svg_document_root_is_svg`), reached from
`html.rs:799-811` (`image_extension_from_mime_type` accepts `image/svg+xml`) and
`html.rs:736-770` (local image files of any type are read and sniffed)

The 10d resolution dropped SVG from the editor upload path — `images.rs` no longer
detects or accepts it, with a test pinning the rejection — but `write_gtms.rs` carries
its *own* `svg_document_root_is_svg` sniffer, and the HTML import accepts SVG both as a
data-URI (`image/svg+xml` is in the mime allowlist) and as a local file next to a
dropped HTML page. So the import pipeline writes exactly the unsanitized stored SVGs the
10d decision was meant to keep out of repos, with the same latent stored-XSS posture
(safe today: export and editor render uploads in `img`/data-URL contexts only). Same
classification as 10d m1, same conservative fix.

| Fix | Description |
|---|---|
| **A ✓** | Remove the `svg` arm and the XML sniffer from `detected_imported_image_extension` (and `image/svg+xml` from `image_extension_from_mime_type`); an SVG image then degrades to "no image for this block", consistent with other unsupported types. Mirror the 10d test. The export-side `svg` mime entry for legacy stored files stays. |

### m2 — Batch import cleanup can shadow the root-cause error

**Severity**: Minor
**Files**: `mod.rs:481-484`, `mod.rs:499-502`

Both failure arms of the batch path run `cleanup_written_imports(&context, &written,
true)?` *before* `return Err(error)`. If the cleanup itself fails (e.g. a locked file on
Windows), the `?` returns the cleanup error and the actual import failure — the thing
the user needs to act on — is lost. `write_parsed_workbook_chapter`'s own cleanup does
this correctly (best-effort, original error preserved). Fix: don't `?` the cleanup;
append its message to the original error (or report it via the non-fatal telemetry
event) so the root cause always surfaces.

### m3 — Quadratic alignment-marker matching lets a crafted page pin an import worker

**Severity**: Minor
**Files**: `html.rs:288-332` (`html_text_alignment_markers`,
`consume_original_center_alignment`), called per block from
`html_blocks_from_fragment:273`

Center-alignment is recovered by matching each extracted block against a `VecDeque` of
markers from the original document, by linear `position()` scan plus `O(n)`
`VecDeque::remove`. When blocks match markers in document order (the normal case) every
scan hits near the front and this is effectively linear. But when block text diverges
from marker text — which the readability rewrite can produce, and an adversarial page
can force — every block scans the *entire* marker queue: `O(blocks × markers)`. A 25 MB
page of tiny paragraphs yields millions of each; that is ~10¹² string comparisons, i.e.
an import that runs for hours on a `spawn_blocking` worker. The single-file import has
no cancellation path (only batches do), so the work is unkillable short of restarting
the app. Fix: index markers by `(text, block_kind)` in a
`HashMap<(String, String), VecDeque<bool>>` built once — O(1) consume, same semantics
for duplicates (consume in document order).

---

## Observations (not findings)

- **Local image containment is done right**: `local_image_field_from_path` canonicalizes
  both the dropped HTML's parent folder and the resolved image path and requires
  `starts_with` — `../` escapes and symlinks pointing outside the folder are both
  rejected. `file:` URLs go through the same gate.
- **Data-URI hygiene is layered**: base64 *length* is checked against the 25 MB limit
  before decoding (no decode-then-check memory spike), whitespace is normalized, decode
  failure and empty payloads degrade to "no image", and the final write is gated on
  magic-byte detection — the claimed mime type is never trusted for content (only for
  the early allowlist).
- **An oversized embedded image fails the whole import** (`data_image_field` returns
  `Err`) while an *invalid* one is silently skipped. Defensible — the user gets an
  actionable size message rather than a mysteriously missing image — but the asymmetry
  is worth knowing about.
- **`import_project_file_bytes` reads any local path the IPC supplies** (drag-drop
  import). This is the feature working as designed — the user picked the file — with
  the usual trusted-webview caveat; the content lands in the user's own visible rows.
  Size-checked from metadata before reading.
- **Noise-image filtering is heuristic but sound**: token matching on
  class/id/src splits on non-alphanumerics (no substring false positives like
  "badge"), tiny/extreme-aspect images are dropped only when *both* dimensions are
  declared, and `aria-hidden`/`hidden`/page-chrome ancestors are skipped.
- **`html_title` does not decode entities** (`&amp;` imports literally; the
  `link_import.rs` twin decodes basic entities). Cosmetic, fallback-path only — the
  readability path supplies its own title. The two near-identical `html_title`
  functions are a small consolidation candidate.
- **Percent-encoded relative image paths** (`image%20name.jpg`) are not decoded before
  joining to the local folder, so such images silently fail to resolve. Cosmetic miss;
  the URL-join path handles them fine.
- **The whole document is parsed up to four times** (alignment markers, readability,
  fallback, fragment) — fine at the 25 MB cap, worth knowing before raising the limit.
- **Batch cancellation is cooperative and race-tolerant**: checked between files in
  both the parse and write loops; the cancel set entry is always cleared on every exit
  path; cancellation mid-write still commits what was written (reported via
  `canceled: true`), which matches the UI contract.
- **`fallback_article`'s scoring cannot underflow**: the `link_density_percent > 35`
  filter runs before the subtraction, and text length is already ≥ 500 there.

---

## Resolution status

| Finding | Status | Notes |
|---|---|---|
| M1 | Resolved | `cleanup_written_imports` moved into `write_gtms.rs` and run on the single-file commit-failure path; `prepare_project_import_repo` preflights `ensure_local_commit_preconditions` so expected gate failures reject before anything is parsed or written. Test pins that cleanup unstages, removes the chapter, drops an import-created `.gitattributes`, and leaves a clean tree. |
| m1 | Resolved | SVG detection arm, the XML root sniffer, and the `image/svg+xml` mime entry removed; an SVG degrades to a block without an image. Test mirrors the 10d rejection. |
| m2 | Resolved | Both batch failure arms route through `with_cleanup_failure` (cleanup errors append to, never replace, the root cause); the cancel-set clear on error paths is best-effort since a stale unique batch id is harmless. |
| m3 | Resolved | Markers keyed by `(text, block_kind)` in a `HashMap` of per-key queues consumed in document order — O(1) per block. Test pins duplicate-text ordering. |

---

*Manual review following the Rust Review Strategy, Batch 11 session 2 of 3. M1 was
verified by contrasting the single-file and batch commit paths line-by-line; m1 by
diffing `detected_imported_image_extension` against the post-10d
`detected_uploaded_image_extension` (and its SVG-rejection test); m3 by cost analysis of
the marker scan under the 25 MB input bound. Image-path containment, slug/filename
sanitization, and data-URI limits were traced into `write_gtms.rs` and
`short_path_names.rs`.*
