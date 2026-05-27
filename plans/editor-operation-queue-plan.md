# Editor Operation Queue Implementation Plan

## Goal
Make editor interactions optimistic by moving save/commit serialization out of UI disabling and into a scoped editor operation queue. Editor controls should stay clickable while previous saves are pending. The queue handles ordering, coalescing, stale response suppression, success reconciliation, and failure display.

## Plan Index
Implement this in slices, in this order:

1. `plans/editor-operation-queue-foundation-plan.md`
   - Adds the shared `repoWriteQueue`, editor operation queue layer, repo scope model, tests, and render hooks.
   - All project repo writes, including editor writes and project/background sync, must use the shared repo write queue.
   - Should not remove visible disabled states by itself.
2. `plans/project-page-repo-write-queue-plan.md`
   - Integrates the Projects page with `repoWriteQueue`.
   - Covers project refresh/pull, add files/import, chapter lifecycle actions, glossary selector changes, repair/rebuild, and Projects page UI state.
   - This must land before editor row text/marker/style changes rely on project-page operations sharing the queue.
3. `plans/editor-queued-row-text-save-plan.md`
   - Replaces row text save serialization with queue-backed coalescing.
   - This is required before marker/style actions ship, because marker/style should overlap safely with row text saves from their first release.
4. `plans/editor-optimistic-markers-plan.md`
   - Converts `Reviewed` and `Please check` to queued optimistic operations.
   - This should fix the current button lock issue first.
5. `plans/editor-optimistic-text-style-plan.md`
   - Converts row-level text style controls to queued optimistic operations.
6. `plans/editor-optimistic-comments-images-plan.md`
   - Converts comments and image operations after row text semantics are stable.
7. `plans/editor-large-operations-queue-plan.md`
   - Applies queue semantics to larger operations such as replace, clear translations, row delete, restore history, and target language changes.
8. `plans/editor-operation-queue-test-plan.md`
   - Defines the cross-cutting regression matrix for optimistic editor behavior.

## Shared Architecture
Add:
- `src-ui/app/repo-write-queue.js` as the shared repo-level serialization primitive.
- `src-ui/app/editor-operation-queue.js` as the editor-specific optimistic intent/coalescing layer.

Core concepts:
- `operationId`: unique id for each queued intent.
- `repoScope`: `installationId:projectId:repoName`.
- `chapterScope`: `repoScope:chapterId`.
- `rowScope`: `chapterScope:rowId`.
- `kind`: `rowText`, `marker`, `textStyle`, `comment`, `image`, `historyRestore`, `rowLifecycle`, `batchReplace`, etc.
- `status`: `queued`, `running`, `succeeded`, `failed`, `cancelled`.
- `optimisticPatch`: function applied immediately to `state.editorChapter`.
- `run`: async function that invokes the Tauri command.
- `onSuccess`: reconcile payload with current state.
- `onError`: rollback or mark affected operation failed.
- `coalesceKey`: optional key for replacing older pending intents, e.g. `marker:rowId:languageCode:please-check`.

Execution rules:
- Commit-producing operations run serially per `repoScope`, because different chapters in the same project still share one Git worktree and index.
- Row-local operations can be coalesced before execution.
- Latest local intent wins over older async responses.
- Queue state lives outside transient row render state so leaving a row does not destroy pending work.
- UI controls are disabled only for permission, read-only, soft-deleted, or offline constraints, not because a save is pending.
- Every queued operation must re-check current write permission immediately before executing its Tauri command. Optimistic UI may use the editor session snapshot, but commit permission is checked at run time.
- Existing project repo writes, refreshes, imports, and lifecycle operations must use the shared `repoWriteQueue` for that `repoScope`.
- Do not add scattered one-off bridge guards as the long-term synchronization model.

## TanStack Query Position
Use TanStack Query where it fits async data state, not as the full editor write model.

Use it for:
- chapter load/refetch,
- background sync status,
- invalidating/refetching chapter data after queue drains,
- page-level mutation state if it fits the current query-core setup cleanly.

Do not rely on TanStack alone for:
- row JSON merge semantics,
- coalescing marker/style/text operations,
- stale response protection,
- git commit ordering.

If TanStack mutation scopes are useful, wrap them behind `repo-write-queue.js` or `editor-operation-queue.js` so editor code does not depend directly on TanStack APIs.

## Release Strategy
Ship incrementally:
- Foundation can merge first with no visible behavior change.
- Projects page integration should merge next, so project refresh/sync/import/lifecycle operations use `repoWriteQueue` before editor queue behavior depends on it.
- Row text queue ownership should merge before marker/style overlap with row text saves.
- Markers can then ship with full overlap against row text saves and should fix the immediate `Please check` lock.
- Text style can ship next with full overlap against row text and marker saves.
- Comments/images and large operations should ship only after row text, markers, and style have proven the queue stable.

## Completion Criteria
- No editor control is disabled solely because a row save or commit is pending.
- Repeated rapid interactions settle to the latest user intent.
- Stale command responses cannot overwrite newer local state.
- Failed operations surface row/action-specific errors without globally locking the editor.
- `npm test` passes after each slice.
