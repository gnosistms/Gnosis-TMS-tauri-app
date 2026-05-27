# Editor Operation Queue Foundation Plan

## Goal
Introduce the shared repo write queue and editor operation queue without changing visible editor behavior. This phase should create the reusable queue APIs, state model, execution semantics, and tests that later optimistic editor operations can use.

This phase must define the repo-level write boundary used by later phases. No row-adjacent UI lock should be removed until every writer touching the same project repo runs through the shared `repoWriteQueue`.

## Files To Add Or Touch
- Add `src-ui/app/repo-write-queue.js`.
- Add `src-ui/app/repo-write-queue.test.js`.
- Add `src-ui/app/editor-operation-queue.js`.
- Add `src-ui/app/editor-operation-queue.test.js`.
- Update `src-ui/app/state.js` only if queue state belongs in `state.editorChapter`.
- Optionally add small source tests if the queue is intentionally kept separate from `state.editorChapter`.

## Queue Data Model
Each repo write operation should normalize to:

- `operationId`: generated id, stable for the operation lifetime.
- `kind`: short operation kind such as `editor:marker`, `editor:textStyle`, `editor:rowText`, `project:sync`, `project:import`, or `chapter:lifecycle`.
- `repoScope`: string scope for operations that must serialize against the same Git repo, e.g. `installationId:projectId:repoName`.
- `chapterScope`: string scope for chapter-local display and filtering, e.g. `repoScope:chapterId`.
- `rowScope`: string scope for row-local tracking and display.
- `coalesceKey`: optional key used to replace pending older operations.
- `status`: `queued`, `running`, `succeeded`, `failed`, or `cancelled`.
- `createdAt`: timestamp for debugging and deterministic tests.
- `startedAt`: timestamp set when execution begins.
- `finishedAt`: timestamp set on completion.
- `intentVersion`: monotonically increasing integer for stale response detection.
- `renderScopes`: list of render scopes to request after queue state changes.
- `optimisticPatch`: optional function that applies local state immediately.
- `run`: async function that performs the Tauri command or wrapper call.
- `canRun`: optional async function for run-time permission/read-only checks.
- `onSuccess`: optional function to reconcile payload.
- `onError`: optional function to rollback or attach error state.
- `onCancel`: optional function for replaced pending operations.

## Queue API
Implement in `repo-write-queue.js`:

- `enqueueRepoWrite(operation, options = {})`
  - Serializes every Git-writing operation by `repoScope`.
  - Runs non-editor repo operations and editor command operations through the same lane.

- `withRepoWriteQueue(repoScope, operation)`
  - Convenience wrapper for existing async flows during migration.
  - Still uses the same queue internals as `enqueueRepoWrite`.

- `repoWriteQueueSnapshot(scope = null)`
  - Returns current queued/running repo operations.

- `hasPendingRepoWrites(scope = null)`
  - True for queued or running repo writes.

- `flushRepoWriteQueue(scope = null)`
  - Resolves after matching repo writes drain.

Implement in `editor-operation-queue.js`:

- `enqueueEditorOperation(operation, options = {})`
  - Normalizes and stores the operation.
  - Applies `optimisticPatch` immediately unless `options.applyOptimistic === false`.
  - Coalesces pending operations with the same `coalesceKey`.
  - Starts or schedules the corresponding repo write through `repoWriteQueue`.

- `editorQueueSnapshot(scope = null)`
  - Returns a read-only summary suitable for tests and screen models.

- `hasQueuedEditorOperations(scope = null)`
  - True if queued operations exist.

- `hasRunningEditorOperations(scope = null)`
  - True if a matching operation is currently running.

- `hasPendingEditorOperations(scope = null)`
  - True for queued or running operations.

- `latestEditorOperationVersion(coalesceKey)`
  - Returns the latest intent version for stale response checks.

- `operationIsLatestIntent(operation)`
  - True only if the operation still represents the latest intent for its `coalesceKey`.

- `flushEditorOperationQueue(scope = null)`
  - Resolves after matching queued/running operations drain.
  - Used by tests and by navigation paths that still need explicit save completion.

- `resetEditorOperationQueueForTests()`
  - Clears module state for isolated tests.

- `resetRepoWriteQueueForTests()`
  - Clears shared repo write queue state for isolated tests.

## Execution Semantics
- Only one commit-producing operation runs per `repoScope` at a time.
- Different repo scopes may run concurrently.
- Different chapter scopes within the same repo scope must not run concurrently if they write Git state.
- Editor operations do not perform Tauri/Git writes directly; their `run` function enters `repoWriteQueue`.
- Project refresh/sync/import/lifecycle writes also enter `repoWriteQueue`.
- Coalescing should replace only queued operations, not an operation already running.
- If a running operation becomes stale, let it finish but ignore its success payload unless its `onSuccess` explicitly supports merging stale results.
- A failed stale operation should not rollback newer local state.
- A failed latest operation should call `onError` and set `lastError`.
- Queue drain should continue after a failure unless the operation sets `haltScopeOnError`.
- Every operation must run `canRun` or an equivalent current-permission/read-only check immediately before invoking the Tauri command.
- If current permission was revoked while the operation waited, the operation fails with the standard editor permission badge and row/action error state.

## Existing Repo Operation Migration
Before marker or text style blocking is removed, existing row text save commits and project repo operations must enter the shared repo write queue.

Use `withRepoWriteQueue(repoScope, ...)` as the migration path for existing flows that are not yet modeled as editor optimistic operations.

Row text saves must be queue-owned before marker/style phases ship. The selected rollout is full overlap support, not a limited marker self-lock-only slice.

Also identify non-editor project repo operations that can collide with editor commits:
- project refresh/background sync,
- file import/add,
- chapter rename/delete/restore,
- chapter glossary link changes,
- add translation,
- repair/rebuild/re-clone,
- conflicted repo overwrite/recovery,
- project lifecycle operations,
- export paths that require durable local state.

These operations must use `repoWriteQueue`. Avoid scattered one-off bridge guards as the long-term design.

The concrete Projects page integration work is tracked in `plans/project-page-repo-write-queue-plan.md`.

## Render Integration
Queue operations should not call a full render by default. Each operation can request scopes:
- `translate-body`
- `translate-sidebar`
- `translate-header`
- full render only when structurally necessary

The queue should expose a render notifier hook:
- `setEditorOperationQueueRenderHandler(handler)`
- `notifyEditorOperationQueueChanged(operation, reason)`

Keep this thin. Domain operations should still decide which render scopes are needed.

## State Placement
Preferred: keep queue execution module-local and expose snapshots to screen models. This avoids serializing functions inside `state.editorChapter`.

If UI needs durable state inside `state.editorChapter`, store only serializable summaries:
- `operationId`
- `kind`
- `rowId`
- `languageCode`
- `status`
- `message`
- `intentVersion`

Do not store function callbacks in app state.

## Tests
Add repo queue tests for:
- serial execution for same `repoScope`, including different chapter scopes in that repo,
- concurrent execution for different `repoScope`,
- `withRepoWriteQueue` serializes with queued operations for the same repo,
- editor operations and project sync/import operations serialize against each other for the same repo,
- project sync/import operations for different repos can run concurrently,
- helper coverage for consistent project `repoScope` construction,
- run-time `canRun` failure blocks command execution and records operation failure,

Add editor operation queue tests for:
- coalescing queued operations keeps only latest pending operation,
- running operation is not cancelled by a newer intent,
- stale success does not apply when `operationIsLatestIntent` is false,
- stale failure does not rollback newer local state,
- latest failure records queue error and continues draining later operations,
- `flushEditorOperationQueue` waits for queued and running work,
- render notifications fire with expected scopes.

## Acceptance Criteria
- Queue tests pass.
- No existing editor behavior changes yet.
- No UI disabled states are removed in this phase.
- Existing row text commits and project repo operations cannot run concurrently with queued marker/style operations for the same repo.
- `plans/project-page-repo-write-queue-plan.md` has enough inventory detail before editor row text/marker/style phases start.
- `npm test` passes.
