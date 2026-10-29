# Editor image reuse warning

Status: implemented

## Goal

When a user inserts an image into a row (Image URL button or image upload,
including drag and drop), check whether the same image is already used in the
project. Insert silently when it is not. When it is, ask first:

- Title: **Duplicate image**
- Message: "This same image was also used in [chapter file titles]. Are you sure
  you want to use it again here?"
- Checkbox: "Don't show this warning again for this image." When checked and
  the user inserts, later insertions of that image in that project are silent
  (for separator images that are reused on purpose).
- Buttons: **Cancel** | **Insert image**

## What counts as "the same image"

- **URL images:** the same (trimmed) URL.
- **Uploaded images:** the file name first, then the contents.
  - Name: uploads are stored under `chapters/<chapter>/images/` with a
    sanitized, length-limited name, and a `-2`, `-3`... suffix on collision
    (`allocate_short_image_filename`). The name check therefore compares the
    *sanitized base name without the collision suffix* (plus the extension when
    the upload has one). `My Photo.PNG` matches stored `my-photo.png` and
    `my-photo-2.png`. Over-matching here is harmless because contents decide.
  - Contents: compare byte length first (file metadata, no read), then a
    SHA-256 of the bytes. The frontend hashes the upload with WebCrypto
    (native, hardware accelerated) and sends only `{fileName, byteLength,
    sha256}`, so the image bytes are not sent over IPC twice. The backend
    hashes only the stored files that survive the name and size checks.
- **Where:** every active row of every active chapter in the project,
  including other rows of the current chapter. The target row itself (any
  language) is excluded: language variants of one row are translations of the
  same image slot, not a reuse. Soft-deleted chapters and rows are ignored.

## Backend (`src-tauri/src/project_import/chapter_editor/image_reuse.rs`)

- `find_gtms_editor_image_reuse` (read-only, `spawn_blocking`, no repo lock so
  a long sync never blocks the insert):
  1. Build the image key: `url:<url>` or `upload:<sha256>`.
  2. If the key is in the project's local allowlist, return no reuse.
  3. Uploads: walk every chapter's `images/` folder; keep files whose name key
     matches, whose size matches, and whose SHA-256 matches. No matches → no
     reuse (common case, no row files read).
  4. Scan row files of active chapters. A cheap substring check on the raw
     JSON (the URL or the matched file names) skips parsing for almost every
     row. Matching rows are parsed and checked properly.
  5. Return `{ imageKey, chapters: [{ chapterId, title }] }`.
- `allow_gtms_editor_image_reuse`: adds an image key to the allowlist.
- Allowlist storage: local app data,
  `image-reuse-allowlist-v1/<sha256(installationId, projectId)>.json`,
  written atomically. It is a per-device preference, not repo content, so it
  creates no commits.

## Frontend

- `editor-image-reuse-flow.js`: hashing, the check call, the modal state, and
  confirm/cancel. The check fails open: if it errors, the image is inserted.
- `editor-image-flow.js`: URL save and upload run the check right before
  queueing the write. Confirm re-runs row readiness and context resolution
  (the row may have changed while the modal was open) and then queues the
  write without re-checking. Cancel closes the image editor without writing.
  A URL that equals the row's current image skips the check.
- `screens/editor-image-reuse-modal.js`: the modal (shared modal controller
  attributes; Insert image is the default action, Cancel is the dismiss).
- Wiring: `state.js` (modal state), `editor-state-flow.js` (keep the modal
  across same-chapter reloads), `translate.js` (render),
  `actions/translate-actions.js` (confirm/cancel), `input-handlers.js`
  (checkbox).
- Chapter titles come from the project's chapter list in frontend state when
  available (respects pending renames) and are ordered like the file list;
  the backend title is the fallback.

## Tests

- Rust: name-key normalization; URL reuse across chapters and within the
  current chapter; target row exclusion; deleted chapter/row exclusion;
  upload match needs name + contents; allowlist suppresses results.
- JS: modal renderer; URL and upload flows insert silently with no reuse,
  open the modal on reuse, cancel writes nothing, confirm writes, and the
  checkbox records the allowlist entry.
