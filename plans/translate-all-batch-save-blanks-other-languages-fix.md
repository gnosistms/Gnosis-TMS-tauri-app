# Translate All batch save blanks other languages — fix

Status: implemented and tested, not yet committed (2026-11-02)

## Bug

Since v0.8.132 (commit `3932f408`), every AI Translate All batch save wrote an
empty string into every language of the row it did not translate. Reported on
the Runes project (Gnosis VN): the Vietnamese pass blanked Spanish, and the
English pass then blanked Vietnamese (commits `5a884199`, `333ef580`,
`ab47ce42`, `9311166a`, `4c536003`).

Chain:

1. `persistEditorRowsBatch` (`src-ui/app/editor-persistence-flow.js`) sends
   only the translated language in `fields`, but always initialises
   `baseAttributions: {}`.
2. `update_gtms_editor_row_fields_batch_sync`
   (`src-tauri/src/project_import/chapter_editor/row_fields.rs`) enters its
   three-way merge for any row with `base_fields` OR `base_attributions`. With
   no `base_fields` it uses the stored row as the base and merges the partial
   `fields` map against it.
3. `merge_editor_string_maps_by` reads a language missing from `local` as
   `""`, so each language the caller left out counts as a local clear and is
   written as empty.

The response carries no rows for this path, so the editor keeps showing the
old text from memory; the loss only shows after the chapter reloads.

## Fix

- Rust: merge field text only when the caller sent `base_fields`. Without it
  the caller sent a partial update, so the sent fields apply as-is and every
  other language stays as stored (what the "legacy batch callers" comment
  already promises). Same shape as the footnote/caption/attribution merges.
- Frontend: create `baseAttributions` only when an attribution is actually
  being saved, like `baseFootnotes`, so a plain text batch save no longer
  takes the merge path at all.

## Tests

- Rust: a partial batch row without base fields keeps the other stored
  languages; the base-fields path still three-way merges.
- JS: a Translate All style batch save sends only the translated language and
  no empty `baseAttributions`.
