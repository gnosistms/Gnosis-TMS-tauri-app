# Editor Row Merge

## Goal

Add a **Merge** button to the editor row toolbar (next to Insert | Delete). Like
Insert, it opens a modal asking whether to merge with the **previous** or the
**next** row. Each direction button is disabled when there is no active row in
that direction; the toolbar Merge button is disabled when there is no active
neighbor at all.

## Semantics

A merge always combines two adjacent **active** rows (soft-deleted rows in
between are skipped when finding neighbors). Call the earlier row `prev` and
the later row `next`:

- Clicking Merge on row R and choosing **Previous** → `prev` = nearest active
  row above R, `next` = R.
- Choosing **Next** → `prev` = R, `next` = nearest active row below R.

The merged content is written into `prev` (it keeps its row id, order key,
text style, comments, and review flags). `next` is **soft-deleted** in the same
commit, so its full original content remains recoverable via Restore.

### Per-language content rules

For each language code present in either row's fields:

1. **Footnote renumbering.** Compute `offset` = highest footnote marker used by
   `prev` (in its body text and its footnote list). If `next` uses any markers,
   shift all of `next`'s markers by `offset` — both the unescaped `[n]` markers
   in its body text (escaped `\[n\]` markers are left alone) and the markers in
   its footnote entries. This keeps every marker pointing at its own footnote.
2. **Body text.** `prev.text + "\n" + shiftedNext.text`. If one side is empty,
   the result is just the other side (no stray newline).
3. **Footnotes.** `prev`'s entries followed by `next`'s shifted entries,
   serialized in the legacy labeled format (`[1] text\n\n[2] text`; a single
   marker-1 entry stays bare, matching `serializeEditorFootnotesForLegacy`).
4. **Images and captions** (the stored model is one image per language per row;
   the row-level "one image per row" rule generalizes per language):
   - Neither row has an image → captions merge like body text (join non-empty
     values with a newline).
   - Only one row has an image → the merged row takes that image and its
     caption (without merging any orphan caption from the other row). When it comes from `next`, the image reference and caption are
     **cleared from `next`** in the same commit (moved, not copied) so a later
     permanent delete of the soft-deleted row cannot remove an uploaded image
     file the merged row still references.
   - Both rows have an image for the same language → merge everything except
     images and captions: `prev` keeps its own image + caption, `next` keeps
     its image + caption on its soft-deleted row for the user to handle.

Word counts stay conserved automatically (deleted rows are excluded from
counts, and the moved text lands in `prev`).

## Backend (Rust)

- `src-tauri/src/project_import/chapter_editor/row_merge.rs` (new):
  `merge_gtms_editor_rows_sync(app, input)`.
  - Input `MergeEditorRowsInput { installationId, projectId, repoName,
    chapterId, previousRowId, nextRowId }`. Backend validates both rows exist,
    are active, `prev.order_key < next.order_key`, and no active row sits
    between them — errors ask the user to refresh if the structure changed.
  - Builds merged `prev` row JSON with the existing appliers
    (`apply_editor_plain_text_updates`, `apply_editor_footnote_updates`,
    `apply_editor_image_caption_updates`, `apply_editor_field_image_update`),
    sets `next.lifecycle.state = "deleted"` (clearing moved image/caption),
    and writes both files in **one commit** via `write_row_files_and_commit`
    with `operation: "merge"`, message `Merge row {next} into {prev}`.
  - Footnote helpers: marker parsing mirrors the JS escape rule (a marker is
    unescaped when preceded by an even number of backslashes); footnote-list
    parsing reuses `parse_labeled_footnote_text_for_merge` (moved/shared from
    `row_fields.rs`).
  - Response `MergeEditorRowsResponse { row, removedRow, removedRowId, removedLifecycleState,
    wordCounts, chapterBaseCommitSha }` (`row` built with
    `editor_row_from_stored_row_file_with_update`).
- Command wrapper `merge_gtms_editor_rows` in `project_import.rs`
  (spawn_blocking, same shape as insert), registered in `lib.rs`.
- Unit tests for marker shifting, footnote combination, and the image cases.

## Frontend (JS)

- `src-ui/app/editor-row-merge-content.js` (new, pure): `maxEditorFootnoteMarker`,
  `shiftEditorFootnoteMarkers(text, offset)`, and
  `mergeEditorRowContent(prevRow, nextRow)` implementing the rules above on the
  editor row shape. Used by the regression-fixture path and unit-tested as the
  reference semantics (`editor-row-merge-content.test.js`).
- `state.js`: `createEditorMergeRowModalState()` (`{ rowId }` entity modal),
  added to the chapter state factory; `editor-state-flow.js` preserves it
  across snapshots the same way as `insertRowModal`.
- `editor-row-structure-state.js`:
  - `adjacentActiveEditorRowIds(rows, rowId)` → `{ previousRowId, nextRowId }`
    (nearest active neighbors, skipping deleted rows).
  - `openMergeEditorRowModalState` / `cancelMergeEditorRowModalState`.
  - `applyMergedEditorRowState(chapterState, mergedRow, removedRow,
    wordCounts, triggerAnchorSnapshot)` — replaces `prev` with the normalized
    merged row, marks `removedRowId` deleted (reusing the soft-delete group
    bookkeeping), clears active-field state if it pointed at the removed row,
    closes the modal, anchors on the merged row.
- `editor-row-structure-flow.js`: `openMergeEditorRowModal`,
  `cancelMergeEditorRowModal`, `confirmMergeEditorRows(render, direction,
  operations)` — fixture path computes the merge client-side via
  `mergeEditorRowContent`; real path runs `ensureEditorRowReadyForWrite` on both
  rows, then `invokeEditorWriteCommand("merge_gtms_editor_rows", …)` with the
  insert modal's loading/error pattern, applying the result through
  `applyStructuralEditorChange` (body render, per the scroll rules).
  Pending changes for both rows are queued before the merge on the shared
  project repo-write lane, so their durable saves complete first. The updated removed row is applied locally so any
  moved image and caption disappear from the deleted row immediately.
- `screens/editor-row-merge-modal.js` (new) rendered from `screens/translate.js`
  next to the insert modal: "Previous" / "Next" primary buttons, each disabled
  when that neighbor is missing.
- `editor-screen-model.js`: `canMergePrevious` / `canMergeNext` on the row model
  (active + `canEditRows` + neighbor exists).
- `editor-row-render.js`: `Insert | Merge | Delete`, Merge via `textAction`
  with `disabled` when no neighbor exists.
- `actions/translate-actions.js`: `open-merge-editor-rows:` (session-write
  prefix), `confirm-merge-editor-rows-previous` / `-next` (current-write
  actions), `cancel-merge-editor-rows`.

## Tests

- `editor-row-merge-content.test.js`: footnote renumbering (incl. escaped
  markers and marker-only collisions), empty-side text joins, image cases
  (only prev / only next / both / neither, upload move).
- `editor-row-structure-state.test.js`: adjacency helper (skips deleted rows,
  chapter edges) and `applyMergedEditorRowState`.
- Rust `row_merge.rs` tests mirroring the content rules.
- `npm test`, `cargo test`, `npm run audit:unused`.
