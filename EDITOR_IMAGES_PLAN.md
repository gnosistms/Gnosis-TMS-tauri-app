# Editor Images

## Summary

Add one image per language in the editor. Each language can have either:

- no image
- one image linked by URL
- one uploaded image stored in the repo

The add-image controls live in the same action row as `P / H1 / H2 / Q / I / *`. The `*`, `img url`, and `img ↑` controls belong to the same secondary group with no separator between them. The separator remains only between the text-style group and this secondary group. The image controls are:

- `img url` with tooltip `Add image by link`
- `img ↑` with tooltip `Upload image`

Image controls must appear immediately when a language becomes active, based on already-loaded row state plus local editor UI state. Do not defer button visibility to a later async check.

Uploaded images are committed into the chapter's `images/` folder. URL images and uploaded images render the same way in the editor. In history and Review > Last update, do not render the actual image; show image metadata as text instead:

- URL image: show the saved URL
- uploaded image: show only the filename

## Key Changes

### 1. Storage and row data

- Extend stored row data so each language can store its own image metadata.
- Store image data alongside the rest of that language's editor data, not as a row-global field, because images may contain language-specific text.
- Represent per-language image state as:
  - no image
  - URL image
  - uploaded image
- Store enough metadata to support rendering, removal, history display, and restore. For uploaded images this includes the repo-relative asset path; for history display we also need the filename.
- Extend `EditorRow` to return per-language image metadata with the rest of the row payload.
- Treat images as part of row persistence for dirty tracking, save reconciliation, stale reload, conflict detection, and revision-token generation.

### 2. Uploaded asset storage and lifecycle

- Store uploaded assets under `chapters/<chapter>/images/`.
- Use row- and language-scoped filenames to avoid collisions, for example `row-<rowId>-<languageCode>-<uuid>.<ext>`.
- When a language image is uploaded:
  - validate the file
  - copy it into the chapter image folder
  - update the row JSON for that language
  - stage and commit both the asset and row JSON
- When a language image that was uploaded is removed:
  - delete the asset file
  - clear that language's image metadata
  - stage and commit both changes
- When a row is permanently deleted, remove all uploaded image assets for all languages in that row and commit them with the row deletion.

### 3. Editor UI and interaction

- Add two image buttons next to the footnote button in the active language action row:
  - `img url`
  - `img ↑`
- Style both buttons like the existing text-style and footnote buttons.
- Keep `*`, `img url`, and `img ↑` in one shared secondary control group with no separator between those three buttons.
- Keep a single separator only between the `P / H1 / H2 / Q / I` group and the `* / img url / img ↑` group.
- Hide both buttons for a language as soon as that language already has an image.
- Keep button visibility synchronous with row activation so there is no delayed appearance race.
- Add a per-language image area beneath the footnote if a footnote is visible, or beneath the main text if no footnote is visible.
- URL images and uploaded images use the same preview surface once saved.
- Small preview rules:
  - max height `100px`
  - max width equal to the available editor-pane width
  - preserve aspect ratio while resizing with the window
- Next to the small preview, show an `x` button with tooltip `Remove image`.

### 4. Add image by URL flow

- Clicking `img url` opens a text box beneath the footnote or main text for that language.
- Placeholder text: `paste image url here`
- Blurring the URL box triggers validation:
  - confirm the URL is well-formed enough to attempt loading
  - confirm the image can be loaded and rendered
- If validation succeeds:
  - persist the image metadata for that language
  - show the normal image preview
- If validation fails:
  - do not save an image for that language
  - show an inline warning banner in place of the image area with the text `Invalid image URL`
- Clicking the remove button for a saved URL image returns that language to the no-image state so the add-image buttons are available again.

### 5. Add image by upload flow

- Clicking `img ↑` opens an upload box beneath the footnote or main text for that language.
- Box text: `Drag and drop an image file or click to select.`
- Clicking the box opens the OS native file picker via a hidden file input restricted to common browser-supported image formats, including at least:
  - jpg / jpeg
  - png
  - gif
  - svg
  - webp
  - avif
  - bmp
  - ico
  - apng
- Dropping a file and selecting a file from the picker must use the same validation path.
- If the file is invalid, show a modal with:
  - Eyebrow: `Invalid file`
  - Title: `The file you uploaded is not a valid image or could not be opened.`
  - Button: `Ok`
- If the file is valid:
  - persist the uploaded asset and row metadata
  - show the standard image preview for that language

### 6. Validation

- Validate uploads in the frontend for fast feedback.
- Validate uploads again in the backend before writing or committing.
- Do not trust file extension alone; confirm the file can actually be opened as an image.
- SVG needs explicit validation rather than extension checking only.
- URL validation should confirm loadability, not just string shape.

### 7. Large preview overlay

- Clicking a saved image preview opens a larger borderless preview overlay.
- The image scales responsively so neither width nor height exceeds the available viewport space, with a small gutter left around it.
- Clicking outside the image closes the overlay.
- The overlay is not a dialog card with labels or controls; it is just the enlarged image on a backdrop.

### 8. Focus, render timing, and local editor state

- Follow the footnote UI pattern for local editor-state toggles:
  - opening the URL input
  - opening the upload dropzone
  - focusing the new control on the next frame after render
  - collapsing empty local image UI when focus leaves the language cluster
- Do not route image add/remove behavior through the footnote text-save path.
- Keep image editor state separate from text style so pressing `P / H1 / H2 / Q / I` only affects the main text, never the footnote or image UI.
- Extend the active-language focus cluster logic so using the image buttons or moving between main text, footnote, and image inputs does not leave stuck controls behind.

### 9. Virtualization, autosize, and responsive layout

- Add the following to row-height syncing and virtualization:
  - URL input
  - upload box
  - inline invalid-URL banner
  - small image preview
- Re-sync layout when:
  - a URL input opens or closes
  - an upload box opens or closes
  - an invalid-URL banner appears or disappears
  - an image loads
  - an image is removed
  - the window resizes

### 10. History, Review > Last update, and restore

- Include per-language image metadata in history entry equality and current-entry matching so image-only changes remain visible.
- In history and Review > Last update:
  - do not render the actual image
  - show the image metadata together with the language's visible content
  - URL images render as the saved URL text
  - uploaded images render as the filename only
- Treat image metadata more like main content than like review markers. Avoid building a separate special-case note stack for image changes.
- Restoring a history entry for a language restores that language's:
  - main text
  - footnote
  - markers
  - text style
  - image metadata

### 11. Scope exclusions for v1

- Editor search does not index image URLs or uploaded filenames in v1 unless we explicitly decide to extend it later.
- Project-wide search does not index image metadata in v1.
- Source word counts, glossary matching, and AI translation/review prompts continue to use only the main translation text.

## Test Plan

- Rust:
  - missing image metadata defaults to no image
  - inserted rows initialize with no language images
  - uploaded image writes update row metadata and stage the asset
  - uploaded image removal deletes the asset and updates row metadata
  - permanent row delete removes uploaded assets for all languages in the row
  - revision tokens change when language image metadata changes
  - restore returns and reapplies per-language image metadata
  - history builder keeps image-only commits visible
- JS/unit:
  - row normalization includes per-language images
  - screen-model button visibility is immediate for `img url` and `img ↑`
  - a language with an image hides only that language's add-image buttons
  - URL validation success and invalid-URL banner behavior work
  - upload-box open/close state follows the same local UI flow as footnotes
  - focus transitions between main text, footnote, and image controls do not leave stuck controls behind
  - history matching includes image metadata
  - history/review display URL text for URL images and filename text for uploaded images
- Browser:
  - active language shows `P / H1 / H2 / Q / I` followed by one separator, then `* / img url / img ↑` immediately
  - clicking `img url` opens the URL box in the correct position
  - clicking `img ↑` opens the upload box in the correct position
  - dropping or selecting an invalid file shows the invalid-file modal
  - dropping or selecting a valid file uploads, commits, and renders the preview
  - invalid image URLs show the inline `Invalid image URL` banner
  - saved URL and uploaded images render the same small preview UI
  - clicking an image opens the large responsive overlay
  - clicking outside the large image closes the overlay
  - removing an uploaded image deletes the asset and restores the add-image buttons for that language
  - removing a URL image restores the add-image buttons for that language
  - permanent row delete removes all uploaded image assets attached to that row

## Implementation Notes

- The frontend interaction shell can closely follow the footnote flow:
  - action-row visibility
  - local open/close state
  - focus-after-render
  - blur/collapse timing
- The persistence path should not follow the footnote text-save pipeline directly.
- Use dedicated image commands for:
  - saving a URL image
  - uploading an image
  - removing an image
  - deleting uploaded assets during permanent row deletion

## Assumptions

- One image per language in v1.
- No multiple images per language in v1.
- URL and uploaded images share the same display UI in the editor once saved.
- History and Review > Last update show image metadata as text, not image previews.
