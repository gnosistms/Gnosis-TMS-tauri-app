# Batch 10d Review Fixes — Chapter Selection + Images

**Status: complete (2026-06-10).** S1, M1, m1 landed on
`fix/batch-10d-review-findings`. m1 was resolved by dropping SVG from accepted uploads
(conservative choice over shipping a sanitizer).

Resolves the findings from `reviews/2026-06-10-batch-10d-review.md` (S1, M1, m1).
Branch: `fix/batch-10d-review-findings`. One focused commit per finding.

## S1 — Route image row paths through `validated_row_json_path`

`images.rs`: the three `chapter_path/rows/{row_id}.json` constructions
(`save_gtms_editor_language_image_url_sync`, `upload_gtms_editor_language_image_sync`,
`remove_gtms_editor_language_image_sync`) switch to the existing `validated_row_json_path`
from `shared.rs` — the last occurrence of the 10a/10b row-id traversal pattern. One-line
change each; no new helper.

## M1 — Chapter settings commits flow through `write_row_files_and_commit`

`chapter_selection.rs`: the three single-file `chapter.json` settings edits
(`update_gtms_chapter_language_selection_sync`, `update_gtms_chapter_glossary_links_sync`,
`update_gtms_chapter_workflow_status_sync`) replace their write → `git add` → commit with
the 10a `write_row_files_and_commit` helper (file-agnostic; 10c already uses it for
`chapter.json`). One `PreparedRowFileWrite` per edit, with the current on-disk text as the
rollback original, serialized to match `write_json_pretty` (`to_string_pretty` + `\n`).
`update_gtms_chapter_languages_sync` already has its own clean-tree precondition + hard-reset
rollback and is left as-is.

## m1 — Drop SVG from the accepted upload set

`images.rs`: remove the SVG acceptance so an unsanitized SVG (which can carry
`<script>`/`on*`/`<foreignObject>`) can never be stored and travel to teammates via git.
- `normalize_uploaded_image_extension`: drop the `"svg"` arm.
- `detected_uploaded_image_extension`: drop the `svg_document_root_is_svg` branch and remove
  the now-unused `svg_document_root_is_svg` helper (and its `XmlReader`/`XmlEvent` use if it
  becomes unused).
- Existing raster formats (png/jpg/gif/webp/avif/bmp/ico) are unchanged.
- This is the conservative choice over shipping an SVG sanitizer; revisit if teams need SVG.

## Verification

- `cargo test --lib` in `src-tauri` (new test for S1 path validation reuse is covered by
  the shared helper's own tests; add an images-level assertion that SVG bytes are now
  rejected).
- `cargo clippy` to confirm no dead code remains after removing the SVG path.
