# Image URL Conflict Resolution Plan

> Status: implemented 2026-06-25. JS + Rust changes landed with unit tests
> (1546 JS, 360 Rust passing). Requires a release for teammates (backend command
> `update_gtms_editor_row_fields` now carries `images`/`base_images`).

## Goal

Let the editor conflict-resolution modal surface and resolve **image URL** conflicts,
mirroring how it already handles translation text, footnotes, and image captions:
read-only blocks for "Your version" and the GitHub version, plus an editable
"Resolved image URL" field seeded by the Copy buttons.

Scope (decided 2026-06-25): **URL-kind images only** (`{ kind: "url", url }`).
Uploaded-file image conflicts (`kind: "upload"`) remain out of scope and keep their
current `unsupported` (silently dropped) behavior.

## Current Gaps

1. **Image conflicts never surface.** `mergeImageSlices` returns
   `status: "unsupported"` when both sides change an image differently
   (`editor-row-merge.js`), and `applyDirtyRowSyncResults` in
   `editor-background-sync.js` only handles `"merged"` and `"conflict"`. An image
   conflict is silently dropped.
2. **`conflictedLanguageCodesForRow`** (`editor-conflicts.js`) ignores images, so even
   if a conflict surfaced, the language code would not be offered and the save guard
   would reject it.
3. **The save command carries no images.** `update_gtms_editor_row_fields`
   (`row_fields.rs`) merges `fields`/`footnotes`/`image_captions` but not images.
4. **The modal has no image fields.**

## Design

A URL conflict only surfaces when **both sides are URL-resolvable** (each side is
either a `url`-kind image or absent/removed). If either changed side is an `upload`,
keep returning `unsupported`. Because in-scope resolves never involve an uploaded file
on the current-on-disk side, the backend apply is a pure row-JSON rewrite — no
uploaded-file deletion / `git rm` / rollback-snapshot machinery needed.

Persistence stays a **single atomic `update_gtms_editor_row_fields` call** (same as the
other fields). The command gains optional `images` / `base_images` maps; when present it
does a URL-only three-way merge against the current on-disk image and applies the result
via the existing `apply_editor_field_image_update`.

### Image value model

A per-language image conflict is represented in the modal as a **URL string**
(empty string = "no image / removed"). Converting back to a stored image:
`""` → `null` (remove); non-empty → `{ kind: "url", url }`.

## Changes

### Frontend — detection

- `editor-images.js`: add `editorFieldImageUrl(image)` (url for url-kind, `""`
  otherwise) and `imageUrlIsResolvable(image)` (`null`/absent or `kind === "url"`).
- `editor-row-merge.js` `mergeImageSlices`: when `localChanged && remoteChanged &&
  !equal`, emit a **conflict entry** (`{ kind: "image", languageCode }`) instead of
  `hasUnsupportedConflict` **iff** both `localValue` and `remoteValue` are
  URL-resolvable; otherwise keep `hasUnsupportedConflict`. Surface image conflicts in
  the `conflicts` array so `mergeEditorRowVersions` returns `status: "conflict"`.
- `editor-conflicts.js` `conflictedLanguageCodesForRow`: include a language code when
  the local vs remote image URLs differ (URL-resolvable only).
- `editor-persistence-state.js` `applyEditorRowConflictDetected` callers / state:
  ensure `baseImages` / `localImages` are carried alongside the existing base/local
  fields so the modal and save state can read them. (`conflictState.remoteRow.images`
  already exists from the payload.)

### Frontend — modal model (`editor-conflict-resolution-model.js`)

- `buildEditorConflictResolutionModalState`: add `localImageUrl`, `remoteImageUrl`,
  `finalImageUrl` (default `finalImageUrl = remoteImageUrl`, remote-wins like the rest).
- `buildEditorConflictResolutionVersionSelection`: include `finalImageUrl`.
- `buildEditorConflictResolutionSaveState`: when the modal shows an image conflict,
  build `imagesToPersist = { [lang]: urlImageOrNull(finalImageUrl) }` and
  `baseImages = { [lang]: remoteImageOrNull }`.
- `editorConflictResolutionShowsImages(modal)`: parallel to
  `editorConflictResolutionShowsImageCaptions`.

### Frontend — modal render (`screens/editor-conflict-resolution-modal.js`)

- Add image URL to `renderVersionStack` (read-only, conditional on `showImages`).
- Add a "Resolved image URL" editable field
  (`data-editor-conflict-final-image-input`) below the existing resolved fields,
  conditional on `showImages`.

### Frontend — flow + wiring

- `editor-conflict-resolution-flow.js`:
  - `updateEditorConflictResolutionFinalImageUrl`.
  - `copyEditorConflictResolutionVersion`: also set `finalImageUrl`.
  - `saveEditorConflictResolution`: pass `images` / `baseImages` to the command when an
    image conflict is being resolved.
- `state.js` `createEditorConflictResolutionModalState`: add image fields.
- `input-handlers.js`: handle `data-editor-conflict-final-image-input`.
- `autosize.js`: add the new selector.
- `translate-flow.js`: re-export `updateEditorConflictResolutionFinalImageUrl`.

### Backend (`src-tauri/src/project_import/chapter_editor/row_fields.rs`)

- Add optional `images` / `base_images` (`BTreeMap<String, Option<FieldImageInput>>`)
  to `UpdateEditorRowFieldsInput`.
- When provided, three-way merge per language against the current on-disk image
  (URL identity). Conflict → report like fields/footnotes; resolved → apply via
  `apply_editor_field_image_update`. No uploaded-file cleanup needed (in-scope sides
  are URL/absent).
- Return merged images in the response base echo if needed for parity.

### Labels

The resolved fields were renamed in the prior change ("Resolved translation text",
"Resolved footnote text", "Resolved image caption text"). The new field is
"Resolved image URL".

## Tests

- `editor-row-merge.test.js`: URL image divergence yields `status: "conflict"`;
  upload divergence still `unsupported`.
- `editor-conflicts.test.js`: image URL divergence adds the language code.
- `editor-conflict-resolution-model.test.js`: modal state image fields; selection
  includes `finalImageUrl`; save state builds `imagesToPersist`/`baseImages`;
  `editorConflictResolutionShowsImages`.
- `editor-conflict-resolution-modal.test.js`: image fields render only when
  `showImages`.
- Rust unit tests in `row_fields.rs`: URL image three-way merge (clean + conflict).

## Out of Scope

- Uploaded-file image conflicts.
- Changing how non-conflicting image edits are merged.
