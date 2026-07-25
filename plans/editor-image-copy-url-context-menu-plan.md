# Editor Image Context Menu Plan

## Goal

Show a context menu when the user right-clicks any editor image thumbnail or
full-size preview, whether the image is URL-linked or uploaded locally. Preserve
the existing click-to-preview behavior and image styling.

The menu is image-aware:

- URL-linked images (`kind: "url"`) include `Copy image URL`, which copies the
  original stored URL. This is the first menu item and is separate from duplication
  actions.
- Uploaded images do not include `Copy image URL`.
- In a multi-language row, add one flat menu item for each other language that
  exists in the row, labeled `Duplicate to {Language}` (for example,
  `Duplicate to Spanish` and `Duplicate to English`).
- Never list the source language. List occupied destinations as well as empty
  destinations.
- Selecting an empty destination duplicates immediately. Selecting an occupied
  destination opens a small confirmation modal stating that `{Language} already
  has an image` and asking whether to overwrite it, with `Cancel` and `Overwrite`
  actions. Only `Overwrite` replaces the destination image; `Cancel` leaves both
  images unchanged.
- Duplication copies the image to the selected destination and leaves the source
  image intact. It duplicates only the image; source and destination captions
  remain unchanged.
- Do not use a submenu or separate destination picker.

## Existing Modal Pattern

Reuse the editor's established modal route rather than introducing new modal
styling:

- Add a focused renderer alongside existing editor confirmation renderers such as
  `editor-row-permanent-deletion-modal.js`.
- Mount it from the existing modal sequence in `screens/translate.js`.
- Store its open/status/error and row/source/destination identity in
  `state.editorChapter`, using a state factory in `state.js`.
- Route `Cancel` and `Overwrite` through `actions/translate-actions.js` into the
  editor image flow.
- Render the established `modal-backdrop`, `card modal-card
  modal-card--compact`, `card__body modal-card__body`, `modal__title`,
  `modal__supporting`, and `modal__actions` structure. Reuse `secondaryButton` and
  `loadingPrimaryButton`/`primaryButton` from `lib/ui.js`, including loading and
  error states. No new visual system or duplicate modal CSS should be added.

## Uploaded Image Duplication Semantics

Current uploaded images are stored as repository-relative asset paths in each
language field. Existing remove, replace, batch-remove, and history code treats an
uploaded path as owned by that field and may delete the file when that field loses
the image. Shared paths are therefore safe only after all asset-release paths use a
single reference-aware helper.

The shared-asset design is:

1. Duplicating an uploaded image stores the same normalized repository-relative
   `path` in the destination field; it does not copy or rewrite image bytes.
2. Before removing any uploaded asset from disk/Git, compute the post-mutation
   row state and delete the candidate path only if no remaining image field
   references it.
3. Overwriting a destination releases its previous uploaded path through the same
   helper. If another field still references that path, retain the asset.
4. Treat uploaded assets as immutable. Duplication only adds a reference; no flow
   may overwrite the bytes of a path that is still referenced elsewhere.

### Shared release helper

Add one backend helper that accepts a set of candidate paths plus pending row
writes/deletions, inspects the affected row's language image fields with the
post-mutation value applied, and returns only paths with zero references in that
row. Requirements:

- Normalize stored separators before comparing paths and validate candidates as
  repository-relative uploaded-image paths.
- Treat all fields in the row as references even when a language is not currently
  visible or the row is soft-deleted.
- For a batch affecting several rows, evaluate each candidate against the complete
  post-batch value of its owning row, not an intermediate field update.
- Run the scan while holding the existing per-repo sync/write lock, after write
  preconditions and base/conflict checks, so another mutation or background sync
  cannot change references between the scan and commit.
- Snapshot, remove, stage, and commit only the paths returned as unreferenced,
  together with the row changes. Rollback restores exact pre-operation files and
  index state; rollback itself must not perform a new reference scan.

The explicit storage invariant is: an uploaded asset may be shared by multiple
language fields in one row, but is not shared across rows. The current model
supports this as the normal case:

- A row is one JSON file with a language-keyed `fields` map.
- Upload/save/remove commands target one row and language, and new upload names are
  collision-safe within the chapter image folder.
- This feature duplicates only between languages in the same row.
- Row merge moves an image reference from one row to another while clearing the
  source in the same commit; it does not intentionally share it.
- Removing a visible chapter language preserves its row field rather than moving
  the image elsewhere.

Under that invariant, the hot-path check is `O(fields in current row)`, needs no
project index, and is practical for every image release.

### Cross-row guard

Cross-row sharing is not a normal editor operation, but it is possible at the
edges. Restoring a pre-merge history entry could reintroduce a path now owned by
the merge destination row; manual/Git edits, imported conflicts, or legacy data
could also contain the same path in multiple rows. The chapter/team copy code does
not create this condition—it allocates copied names per field—but it also does not
prove arbitrary repositories obey the invariant.

Keep the primary helper row-local, and add a defensive fallback only when it says
a candidate has no remaining reference in that row and the asset is about to be
deleted:

- Scan project row JSON files once for those final-release candidates, with all
  pending batch row overlays/deletions applied.
- If another row references a candidate, retain it and surface a diagnostic in
  debug/telemetry so invariant violations can be measured.
- If no other row references it, proceed with the rollback-safe removal.

This fallback is `O(project rows × fields)` only on the last apparent row-local
release, not on duplication or removal while another language in the row still
references the path. It is the lightest safe guard without adding persistent
reference-count metadata.

### Mutation coverage

Every flow that can release an uploaded reference must use the helper:

- Single image removal.
- Replacing an upload with a URL or another upload.
- Image duplication when overwriting an occupied destination.
- Batch actions whose `remove_images` entries clear images.
- Permanent row deletion, checking the deleted row's paths against every remaining
  language in that row, followed by the cross-row final-release guard.
- History restore when it replaces/removes the current image.
- Any conflict-resolution/finalization path that explicitly schedules uploaded
  asset deletion.

Row merge currently moves an image reference between two row files in one commit
and should preserve the asset; if it ever releases a path, it must use the helper.
Removing a language from the chapter's visible language list currently preserves
the row field for later recovery, so it must preserve the asset too; any future
destructive language-field purge must use the helper. Whole-chapter deletion may
remove its contained assets only after ensuring no surviving row outside that
chapter references them.

History restoration needs one additional immutability guard: if historical bytes
for a path differ from an existing file that is referenced by another field, do
not overwrite the shared file. Also preserve the row-local invariant: if the
historical path is currently referenced by another row, allocate a new path for
the restored historical bytes and point only the restored field at it (or stop
with a conflict), rather than creating a cross-row share. Git rollback snapshots
remain an internal atomicity mechanism and restore the exact pre-operation state
without garbage collection.

### Duplicate command and conflicts

The duplicate backend command should re-read and base-check both source and
destination images under the repo lock. An empty-destination duplicate changes
only row JSON. A confirmed overwrite changes row JSON and removes the previous
destination asset only when the post-mutation scan reports it unreferenced. One
rollback-safe signed commit must contain all row and asset changes. Permissions,
write-queue serialization, optimistic updates, and history remain destination
scoped; the source field and captions never change.

Shared assets are reasonable in the same feature only if the reference-safe helper
and migration of every existing release path above ship together. Implementing
shared duplication first and cleanup later is unsafe. Because the helper changes a
foundational storage invariant across several backend flows, the safer delivery is
a separate prerequisite/foundational change (with its own focused plan and commit),
followed by the context-menu duplication feature. It may be released in the same
larger feature branch, but not as an incidental UI-only change.

## Implementation

1. Add context-menu metadata to all image thumbnails and preview overlays,
   including row/language identity, image kind, and the original URL only for
   URL-linked images.
2. Add a delegated context-menu controller that positions a token-styled menu at
   the pointer and dismisses on selection, outside interaction, Escape, blur, or
   resize.
3. Add `Copy image URL` conditionally for URL-linked images and copy through the
   Clipboard API with existing notice/error feedback.
4. Derive duplicate destinations from the current row at menu-open time. Exclude
   only the source language, then render every remaining destination as a flat
   `Duplicate to {Language}` item using its display name.
5. On selection, re-read the destination. Duplicate immediately if it is empty; if
   occupied, store the row/source/destination identity in modal state and show the
   overwrite confirmation without changing either image.
6. On `Overwrite`, revalidate the source and destination against current row state,
   then duplicate through the existing editor image write/permission/queue path.
   `Cancel` only closes the modal. URL-linked images retain the same original URL.
   Uploaded images reuse the same repository path, with every released destination
   path filtered through the reference-safe helper. Preserve optimistic state,
   conflict guards, history, and row-scoped rendering, and never mutate the source
   image or either caption.
7. Register the controller and modal actions with the existing translate editor
   DOM events and keep thumbnail and overlay left-click behavior unchanged.

## Verification

- Test menus on both thumbnails and full-size previews for URL-linked and uploaded
  images.
- Verify `Copy image URL` is the first item for URL-linked images, is absent for
  uploads, and copies the exact original URL.
- Verify flat `Duplicate to {Language}` entries include every non-source language,
  whether empty or occupied, and exclude only the source language.
- Verify empty destinations duplicate immediately without a modal.
- Verify occupied destinations show the correct language-specific warning;
  `Cancel` changes nothing and `Overwrite` replaces only the destination image.
- Verify the confirmation renderer uses the existing compact modal structure,
  shared button helpers, loading/error behavior, and modal CSS.
- Verify all duplication leaves the source image and every caption unchanged and
  correctly persists URL-linked and uploaded images.
- For uploads, verify source and destination share one path and exports resolve
  both; removing/replacing either retains the asset while the other references it,
  and the final release removes it from disk and Git.

## Review Hardening

- Canonicalize every uploaded asset identity before comparison or removal. Accept
  legacy `.` and separator variants, but require the resulting path to live below
  `chapters/{chapter}/images/`; reject absolute paths, parent traversal, other
  repository roots, and any existing symbolic-link component.
- Hold the shared per-repository synchronization lock from baseline reads through
  conflict checks, post-mutation reference scans, snapshots, writes, removals, and
  commit. Call a lock-free commit primitive only from code that already owns the
  lock so the mutex is never acquired reentrantly.
- Carry the exact images shown by the overwrite confirmation across asynchronous
  row-readiness work and compare them again immediately before queueing.
- Keep the flat menu within the viewport with vertical scrolling and implement
  roving focus for Arrow Up/Down, Home, End, Escape, and Tab dismissal.
- Cover duplicate planning, conflicts, caption preservation, shared paths, final
  release, canonical aliases, rejected paths and symlinks, rollback, lock
  serialization, and stale confirmation in focused tests.
- Verify overwriting an occupied destination retains its old asset when referenced
  elsewhere and removes it when unreferenced.
- Cover single remove, URL/upload replacement, duplicate overwrite, multi-row batch
  removal, permanent row deletion, row merge/move, history restore, conflict
  finalization, soft-deleted rows, visible-language removal, cross-chapter/legacy
  references, path-separator normalization, and multiple candidates in one scan.
- Verify the normal reference decision examines only all language fields in the
  affected post-mutation row, including hidden languages and soft-deleted rows.
- Verify the project-wide fallback runs only for apparent final row-local releases,
  retains assets referenced by another row (including pending batch overlays), and
  allows deletion when no external reference exists.
- Verify history restore does not introduce a cross-row share after a row merge;
  it allocates a distinct restored path or reports a conflict.
- Verify a failed write/commit rolls back row files and asset/index state, and that
  concurrent/stale source or destination changes return a conflict without
  releasing an asset.
- Verify history restoration never changes shared bytes in place when another
  field references that path.
- Verify state is revalidated before both modal display and confirmed overwrite,
  along with permission failures, optimistic state, conflicts, and history.
- Run focused editor image render/flow/context-menu and backend command tests.
- Run the full frontend unit suite and unused-export audit if focused checks pass.
- If backend code changes, also run targeted Rust tests and `cargo check`.
