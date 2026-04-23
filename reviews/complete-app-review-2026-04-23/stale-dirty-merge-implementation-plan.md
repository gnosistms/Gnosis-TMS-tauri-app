# StaleDirty Merge Implementation Plan

## Goal
Stop surfacing editor conflicts when local and remote row edits touch different languages or other disjoint row slices.

Desired outcomes:
- auto-merge disjoint local/remote row changes
- patch visible rows live through the existing row-patch seam
- preserve focus for active editor rows
- move true overlapping edits directly into `Conflict`
- keep remotely deleted dirty rows conservative for now so local drafts are not discarded

## Current Flow
- Background sync marks changed rows `stale` / `staleDirty` in `src-ui/app/editor-row-sync-flow.js`.
- Safe unchanged-local rows reload through `reloadEditorRowFromDisk(...)` and the visible-row patch path.
- Dirty rows are excluded from auto-refresh in `src-ui/app/editor-background-sync.js`.
- When a dirty row later saves, the backend compares the whole row base payload against the current on-disk row in `src-tauri/src/project_import/chapter_editor/row_fields.rs`.
- Any mismatch anywhere in row text payload currently returns `status: "conflict"`, even when local and remote changed different languages.

## Narrowest Safe Change Surface
1. Add a shared frontend row merge classifier for `base` vs `local` vs `remote`.
2. Use that classifier in background sync only for rows currently deferred because they are dirty / `staleDirty`.
3. Mirror the same merge rules in the backend row text save path so blur/save stays consistent.
4. Reuse the existing row patch helper and virtualization notification path; do not rewrite virtualization.

## Merge Rules
Per language and per slice:
- `fields.<language>`
- `footnotes.<language>`
- `imageCaptions.<language>`
- `images.<language>`
- `fieldStates.<language>`

Classification:
- unchanged
- local-only change
- remote-only change
- both changed to the same value
- both changed differently

Row outcome:
- no overlapping conflicts: auto-merge
- any overlapping conflict: conflict
- remote row deleted while local row is dirty: stay conservative for now

## Implementation Steps
1. Add `src-ui/app/editor-row-merge.js`
   - classify row slices using `base`, `local`, and `remote`
   - return merged row slices plus conflict metadata

2. Add a state helper in `src-ui/app/editor-persistence-state.js`
   - apply a successful auto-merge
   - remote row becomes the new persisted/base state
   - merged local slices remain current row state
   - row leaves `staleDirty` and becomes `dirty` or `fresh` as appropriate

3. Wire background sync in `src-ui/app/editor-background-sync.js`
   - for deferred dirty rows, load the latest remote row snapshot
   - if mergeable, update state and patch visible rows
   - if conflicting, move row straight to conflict state
   - do not auto-reload dirty deleted rows

4. Mirror merge rules in `src-tauri/src/project_import/chapter_editor/row_fields.rs`
   - replace the current whole-row base mismatch check with per-slice merge classification
   - save merged row content when disjoint
   - return `conflict` only for overlapping slice edits

5. Verify with targeted tests
   - frontend unit tests for merge classification
   - background sync unit tests for auto-merge and direct conflict promotion
   - backend unit tests for disjoint-language save merge vs same-language conflict
   - browser regression for active focused row auto-merge without focus loss

## Deferred
- dirty remote delete special UI beyond the existing conservative behavior
- structural inserted / reordered changes
- broader batch merge heuristics beyond row-local classification
