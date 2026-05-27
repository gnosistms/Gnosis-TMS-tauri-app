# Editor Queued Row Text Save Plan

## Goal
Move row text save/commit behavior into the editor operation queue and shared `repoWriteQueue` while preserving current dirty-row behavior, conflict detection, and merge semantics. Row text saves should not lock marker, style, comment, or image controls.

## Current Model
`persistEditorRowOnBlur` uses `pendingEditorRowPersistByRowId` to avoid concurrent saves for a row. If a save is already running, the row can become dirty again, then the function waits for the existing save and returns. This is partly optimistic for text but still acts as a blocker for other operations.

## Files To Touch
- `src-ui/app/editor-persistence-flow.js`
- `src-ui/app/editor-persistence-state.js`
- `src-ui/app/editor-row-persistence-model.js`
- `src-ui/app/editor-dirty-row-state.js`
- `src-ui/app/editor-background-sync.js`
- `src-ui/app/editor-navigation-guards.js`
- `src-ui/app/editor-chapter-load-flow.js`
- Tests:
  - `src-ui/app/editor-write-guards.test.js`
  - `src-ui/app/editor-persistence-state.test.js`
  - `src-ui/app/editor-row-persistence-model.test.js`
  - `src-ui/app/editor-background-sync.test.js`
  - `src-ui/app/editor-navigation-guards.test.js`

## Behavior
Text editing remains immediate:
- `applyEditorRowFieldInput` continues updating local row fields.
- dirty row tracking remains.
- textarea focus should not be disturbed.

Save behavior changes:
1. Dirty row flush enqueues a `rowText` operation instead of directly owning serialization.
2. Row text operations coalesce by:
   - `rowText:${chapterId}:${rowId}`
3. The operation captures the latest fields, footnotes, image captions, and base maps.
4. If text changes again while a row text operation is running, enqueue a new latest operation behind it.
5. Running operation success reconciles only if it still matches the local intent it saved.
6. If local state changed while the operation was running, success updates persisted/base fields for the saved snapshot but leaves row `saveStatus` dirty so the next queued save persists the latest text.

## Operation Payload
Capture:
- `rowId`
- `fieldsToPersist`
- `footnotesToPersist`
- `imageCaptionsToPersist`
- `baseFields`
- `baseFootnotes`
- `baseImageCaptions`
- `commitMetadata`
- `intentVersion`
- `repoScope`
- `chapterScope`
- `rowScope`
- `coalesceKey`

## Conflict Handling
Preserve current Tauri conflict behavior:
- command can return `status: "conflict"`,
- identical-content conflict can reconcile as success,
- real conflict opens/locks conflict UI,
- row gets `saveStatus: "conflict"`,
- notice badge explains that the translation text changed on disk.

Do not allow marker/style/comment operations to hide a text conflict. If a row is in conflict, later row-local operations should fail or queue behind conflict resolution depending on operation kind.

## Dirty Row Flush
`flushDirtyEditorRows` should:
- enqueue row text operations for dirty rows,
- optionally wait for queue drain when caller requires durable save,
- return true for UI paths that do not require durable save before proceeding.

Split callers into two categories:
- UI-friendly flush: enqueue and continue.
- durable flush: enqueue and wait.

Examples:
- leaving the active textarea can enqueue and continue,
- app shutdown/export may need durable flush,
- opening a different file probably needs at least enqueue plus safe queue ownership before unloading state.

## Navigation
If users navigate away while row saves are pending:
- pending queue entries must retain enough data to finish without relying on visible editor row objects,
- success should update project/chapter cached state if the same chapter is still loaded,
- if not loaded, queue can finish silently and trigger invalidation/refetch later.

This may require queue operations to store full command input, not just row ids.

Concrete requirements:
- Queue entries must store the complete Tauri command input before navigation proceeds.
- Queue callbacks must verify the active chapter identity before mutating `state.editorChapter`.
- If the completed operation is for a chapter that is no longer loaded, record a chapter-level invalidation key such as `editorChapter:${repoScope}:${chapterId}`.
- The next load/refetch for that chapter must ignore stale in-memory rows and read the updated local repo state.
- Failure after navigation should surface through a durable lower-right badge or a pending-saves status area, not by mutating a newly opened chapter with matching row ids.

## Background Sync
Background sync currently skips while row writes are pending. With a queue:
- background sync should wait for the commit queue to drain or run after it,
- sync should not require UI controls to disable,
- if sync detects remote changes while local queue exists, it should defer merge until local queued writes are committed or failed.

Project repo refresh/sync/import/lifecycle operations must use the shared `repoWriteQueue` for the same `repoScope`. A background pull must not run while queued local commits for that repo are running.

## Permission Checks
Optimistic text editing may use the editor session permission snapshot, but queued row text saves must re-check current write permission immediately before invoking `update_gtms_editor_row_fields`.

If permission is denied at run time:
- do not invoke the Tauri write command,
- mark the affected row save as failed,
- set the editor write lock/error state using the existing permission-denied behavior,
- allow navigation flushes to complete without trapping the user.

## Tests
Add tests for:
- dirty row flush enqueues row text operation.
- row text edits while save is running enqueue latest value.
- successful older save does not clear dirty state for newer local text.
- conflict response still opens conflict state.
- marker toggle during text save remains clickable.
- style change during text save remains clickable.
- comment add during text save remains clickable after comments phase is implemented.
- navigation can proceed after queue owns the pending row text operation.
- completion after navigation invalidates/refetches the correct chapter instead of mutating the currently opened chapter by row id.
- run-time permission denial prevents the Tauri command from being invoked.
- background sync waits for the shared `repoWriteQueue` lane for that repo.
- durable flush waits for queue drain.

## Acceptance Criteria
- Row text persistence still handles conflicts correctly.
- Row text save no longer globally blocks marker/style operations.
- Dirty text is not lost when navigating after queue ownership.
- `npm test` passes.
