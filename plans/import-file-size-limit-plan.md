# Plan: Uniform Import / Upload File-Size Limit

## Status

Proposed — 2026-06-03. **Implementation handed off to GPT; review by Claude afterward.**

## Problem

PR #16 added a 25 MB cap to `read_local_dropped_file` (the drag-and-drop bridge), which
resolved Batch 3 m2 *for that path only*. But file bytes reach the importers through **two**
acquisition paths, and only one is capped:

| Acquisition path | Capped today? |
|---|---|
| Drag-and-drop → `read_local_dropped_file` (Rust reads the file) | ✅ 25 MB |
| File picker / readable `File` → `file.arrayBuffer()` in the webview | ❌ **uncapped** |

Both paths feed the same server-side command sinks, which enforce **no** size limit. So a
large file chosen through the picker is still read into the webview (as a heavy
`Array.from(new Uint8Array(...))`) and shipped over IPC uncapped. There is also no single
source of truth for the limit, and no guaranteed user-facing message when a file is rejected.

## Goals

1. **One limit, defined once**, applied **uniformly regardless of import path**.
2. **Authoritative server-side enforcement** so the limit holds no matter how the bytes arrive.
3. **A clear, consistent user-facing message** when a file exceeds the limit (names the file
   and states the limit), surfaced through the existing import error/notice UI.
4. A **front-end pre-check** so oversized files are caught *before* a huge payload crosses
   IPC (better UX, less wasted work) — defense in depth, not the authority.

## Non-goals

- Changing import formats or behavior for within-limit files.
- Streaming/chunked import of very large files (out of scope; we reject, not stream).

## The limit

- **25 MB** (`25 * 1024 * 1024` bytes), matching the existing `read_local_dropped_file` cap so
  nothing regresses. It is a product-tunable knob; if translation source docs ever need more,
  change it in the one place below.
- Measured against the **raw file / decoded content size** (what the user sees), consistent
  across paths. `read_local_dropped_file` uses `metadata.len()`, `File.size` is the same
  measure, and server-side checks use the decoded content length.

## Design

### 1. Single source of truth

- Define **one Rust constant**, e.g. `MAX_IMPORT_FILE_BYTES` in a shared location
  (`constants.rs`), and have `window.rs` use it in place of its local
  `LOCAL_DROPPED_FILE_MAX_BYTES`.
- Mirror it once in JS (e.g. `MAX_IMPORT_FILE_BYTES` in a small shared module such as
  `src-ui/app/import-file-limit.js`) with a comment that it must match the Rust constant.
  (JS only needs it for the pre-check; Rust is authoritative.)

### 2. Authoritative server-side enforcement (the real fix)

Add a shared Rust helper, e.g.:

```rust
pub(crate) fn ensure_within_import_size_limit(byte_len: usize, file_label: &str) -> Result<(), String> {
    if byte_len as u64 > MAX_IMPORT_FILE_BYTES {
        return Err(format!(
            "'{file_label}' is too large to import. The maximum file size is 25 MB."
        ));
    }
    Ok(())
}
```

Call it at every command that accepts file/import/upload **content** (check the decoded
content length), so all acquisition paths are covered uniformly:

- `project_import.rs`: `import_docx_to_gtms`, `import_html_to_gtms`, `import_xlsx_to_gtms`,
  `import_txt_to_gtms`, `import_project_files_to_gtms` (per-file within the batch),
  and `upload_gtms_editor_language_image`.
- Glossary TMX import: `import_tmx_to_gtms_glossary_repo` and `inspect_tmx_glossary_import`
  (whichever first receives the TMX bytes).
- QA TMX import: `import_tmx_to_gtms_qa_list_repo` and `inspect_tmx_qa_list_import`.
- Keep the existing check in `read_local_dropped_file`, switched to the shared constant.

(If the inspect/import command pair shares a common decode helper, enforce there once.)

### 3. Front-end pre-check (UX layer)

The byte-acquisition sites are:

- `project-import-flow.js:174` (dropped) and `:185` (`arrayBuffer`)
- `glossary-import-flow.js:894` (dropped) and `:88` (`arrayBuffer`)
- `qa-list-import-flow.js:816` (dropped) and `:92` (`arrayBuffer`)
- `editor-image-flow.js:1218` (dropped) and `:466` (`arrayBuffer`)

For the **`File`-object paths**, check `file.size` against `MAX_IMPORT_FILE_BYTES` **before**
calling `arrayBuffer()`, and reject with the standard message. For the **dropped paths**, the
Rust `read_local_dropped_file` cap already rejects before reading — surface that error.
A shared JS helper (e.g. `enforceImportFileSizeLimit(sizeBytes, fileName)` that throws/returns
the standard message) keeps it consistent across the four flows.

### 4. User-facing message

One consistent string everywhere (Rust and JS), naming the file and the limit:

> `'<filename>' is too large to import. The maximum file size is 25 MB.`

It must be surfaced through the existing import error path (the flows already use
`showNoticeBadge(..., status: "error")` / `classifySyncError`), so the user sees *what*
happened and *why* — not a silent failure or a generic error.

## Task checklist (for GPT)

- [ ] Add `MAX_IMPORT_FILE_BYTES` to `constants.rs`; replace `window.rs`'s local constant with it.
- [ ] Add `ensure_within_import_size_limit` shared helper (+ unit test: just-under passes, just-over errors with the exact message).
- [ ] Enforce it in every server-side sink listed in §2 (decoded content length).
- [ ] Add `src-ui/app/import-file-limit.js` with the mirrored constant + `enforceImportFileSizeLimit`, with a comment to keep it in sync with the Rust constant.
- [ ] Call the JS pre-check at the four `arrayBuffer()` sites before reading; surface the standard message via the existing notice/error path.
- [ ] Confirm the four dropped-path sites surface `read_local_dropped_file`'s oversize error to the user (not swallowed).
- [ ] Tests: Rust helper unit test; a JS test that an oversized `File` is rejected pre-IPC with the standard message.
- [ ] `cargo test`, `npm test`, `cargo check` clean.

## Acceptance criteria (Claude will verify on review)

- The same 25 MB limit rejects an oversized file via **both** the drag-drop path **and** the
  file-picker/`File` path, for **all four** domains (project, glossary, QA, image).
- Rejection is enforced **server-side** (tamper-proof), with the JS pre-check as a UX layer.
- The user sees the standard, file-named message on rejection in every path.
- One constant governs the limit; no second hard-coded `25 * 1024 * 1024` remains.

## Out of scope / follow-up

- Batch 3 review (`reviews/2026-06-03-batch-3-review.md`) m2 is currently "drag-drop only";
  once this lands, mark m2 fully resolved and reference this work.
