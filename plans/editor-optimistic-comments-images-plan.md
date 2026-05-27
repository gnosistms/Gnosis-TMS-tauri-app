# Editor Optimistic Comments And Images Plan

## Goal
Convert comments and image operations to queue-backed optimistic writes after marker, text style, and row text queue behavior is stable.

## Scope
Comments:
- add comment,
- delete comment.

Images:
- add image URL,
- upload image,
- edit image caption,
- remove image.

## Files To Touch
- `src-ui/app/editor-comments-flow.js`
- `src-ui/app/editor-comments-state.js`
- `src-ui/screens/translate-comments-pane.js`
- `src-ui/app/editor-image-flow.js`
- `src-ui/app/editor-image-state.js` if present, or relevant image helpers.
- `src-ui/app/editor-persistence-flow.js` for shared row pending checks.
- Tests:
  - `src-ui/app/editor-comments.test.js`
  - `src-ui/app/editor-image-flow.test.js`
  - `src-ui/app/editor-write-guards.test.js`
  - `src-ui/screens/translate-sidebar.test.js`

## Comment Behavior
Saving a comment:
1. Create an optimistic local comment with a temporary id.
2. Clear the draft immediately.
3. Show pending status on that comment or comment panel.
4. Enqueue `comment:add` operation at chapter scope.
5. On success:
   - replace temporary comment with server/Tauri comment list,
   - update comments revision/count,
   - update `chapterBaseCommitSha`.
6. On failure:
   - keep optimistic comment visible with failed status and retry affordance, or restore draft.
   - Preferred first implementation: keep failed comment visible with error and allow retry/delete.

Deleting a comment:
1. Hide or mark comment as deleting immediately.
2. Enqueue `comment:delete`.
3. On success:
   - remove comment from confirmed list,
   - update revision/count.
4. On failure:
   - restore comment and show error.

## Comment Coalescing
Do not coalesce independent comment adds.
Coalesce repeated delete requests for the same comment id:
- `commentDelete:${chapterId}:${rowId}:${commentId}`

Comment adds and deletes still serialize by chapter commit scope.

## Image Behavior
Image URL/upload/remove should be optimistic where practical:
- URL add/edit: show new image state immediately after local validation.
- Upload: show local pending image preview if available.
- Remove: hide image immediately.
- Caption edits should eventually ride through row text queue if image captions are stored with row text.

Rollback policy:
- If latest image operation fails, restore previous image state.
- If a newer image intent exists, ignore stale failure rollback.

## Image Operation Payload
Capture:
- `rowId`
- `languageCode`
- `mode`: `url`, `upload`, or `remove`
- previous image state,
- next image state or file reference,
- `intentVersion`,
- `repoScope`,
- `chapterScope`,
- `rowScope`,
- `coalesceKey`.

Coalesce by:
- `image:${chapterId}:${rowId}:${languageCode}`

## Upload Staging
Queued upload operations must not depend on a browser/file-picker temporary reference after enqueue.

Before applying optimistic upload state:
- validate the selected file,
- copy it into an app-controlled staging path,
- store that staging path in the queued operation payload,
- clean up the staging file after success, cancellation, or latest-operation failure.

If staging fails, do not enqueue the operation and show the normal image error.

## Removed Blocks
Remove or relax:
- comment save/delete blocking only because row text, marker, or style save is pending,
- image update blocking only because row text, marker, or style save is pending.

Keep:
- permission/read-only checks,
- soft-deleted checks,
- local validation,
- image upload file validation,
- conflict/remotely deleted checks.
- current write permission checks immediately before each queued comment/image command invokes Tauri.

## Tests
Add tests for:
- comment can be saved while row text save is pending.
- comment can be deleted while marker save is pending.
- failed comment add remains visible with error or restores draft, depending on chosen UX.
- image URL can be changed while marker save is pending.
- image remove can be clicked while row text save is pending.
- upload operation uses a staged app-controlled file path and still succeeds after navigation.
- stale image failure does not rollback newer image state.
- latest image failure restores previous image state.
- run-time permission denial prevents comment/image Tauri commands from being invoked.

## Acceptance Criteria
- Comments and image operations no longer lock on unrelated row save state.
- Failures are scoped to the comment/image operation.
- Latest local image intent wins.
- `npm test` passes.
