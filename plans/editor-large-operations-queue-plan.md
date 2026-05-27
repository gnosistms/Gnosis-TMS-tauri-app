# Editor Large Operations Queue Plan

## Goal
Apply queue semantics to larger editor operations without making them as aggressively optimistic as row-local controls. These operations affect multiple rows, structure, or file language configuration, so they need stable input capture and careful failure handling.

## Operations Covered
- `Unreview all`
- `Clear translations`
- `Replace selected`
- `Batch replace undo`
- `Restore from history`
- `Soft-delete row`
- `Target language manager`
- Opening a different file or leaving the editor with pending saves
- Background sync / refresh while editor writes are queued

## General Policy
- Do not disable unrelated editor controls because one large operation is running.
- Capture the operation's target set at enqueue time.
- Serialize commit-producing operations at repo scope.
- If the operation cannot safely run when it reaches the front of the queue, fail that operation with a clear modal/row error.
- Avoid optimistic structural deletes/restores until rollback behavior is explicit.
- Re-check current write permission immediately before invoking any queued Tauri command.
- Coordinate with non-editor repo operations through the shared `repoWriteQueue`.

## Replace Selected
Current behavior blocks if selected rows are saving.

Target behavior:
- Capture selected row ids and replacement query at enqueue time.
- Disable only the specific running replace submit button, or show it as pending, not the rest of the editor.
- Allow user to change future selection while the current replace runs.
- On success, reconcile changed rows.
- On failure, show replace toolbar/modal error.

Important: selection changes during a running replace apply to the next replace, not the operation already queued.

## Unreview All
Target behavior:
- Capture target language and row ids at enqueue time.
- Enqueue a batch marker operation.
- Apply optimistic marker changes only if rollback is simple enough.
- First implementation can be conservative: show batch pending state, do not disable unrelated controls, but do not optimistically change all rows until command succeeds.

## Clear Translations
Target behavior:
- Capture selected language codes and row ids at enqueue time.
- Because this modifies many row text fields, treat as a batch row text operation.
- Do not run if any targeted row is in conflict/remotely deleted at execution time.
- Conservative first implementation can keep modal loading for the operation itself but not disable unrelated editor controls.

## Batch Replace Undo
Target behavior:
- Capture commit sha at enqueue time.
- At execution time, verify history entry is still valid.
- If pending local row text changes affect rows touched by the undo, fail with a clear error instead of blocking the whole editor beforehand.

## Restore From History
Target behavior:
- Capture active row, language, content kind, and commit sha at enqueue time.
- Apply optimistic text replacement only if conflict/rollback path is clear.
- First implementation can enqueue and show row pending state without disabling unrelated controls.

## Soft-Delete Row
Target behavior:
- Capture row id at enqueue time.
- Since this is structural, first implementation can remain non-optimistic but queued.
- Do not block unrelated rows or controls.
- If row has newer queued local writes, either:
  - queue delete after those writes, or
  - cancel superseded row-local writes if delete should win.

Preferred first policy: row delete wins only after existing queued writes for that row drain; newer edits after delete should be blocked because deleted row is read-only.

## Target Language Manager
Target behavior:
- Capture desired language list at submit time.
- Queue language update after pending row writes.
- Do not keep the whole editor locked while waiting.
- Modal can show pending state for its own submit action.
- If rows changed in a way that makes language update unsafe, fail modal with a clear error.

## Navigation
Opening another file or leaving the editor should not require visible UI to wait for commits if the queue owns complete command inputs.

Target behavior:
- Before navigation, enqueue dirty row text operations.
- Let the queue continue in the background.
- If the app needs to close or export, provide a durable flush path that waits.

## Background Sync
Target behavior:
- Background sync should not start while local commit queue has writes for the same chapter.
- It should schedule itself after the queue drains.
- Refresh UI can show "pending local saves" separately from "syncing".
- Sync should not disable editor controls.

This applies at repo scope, not just chapter scope. A project refresh/pull for the same repo must enter the shared `repoWriteQueue` and wait while any chapter in that repo has queued or running local commits.

## Tests
Add tests for:
- replace captures selected row ids and future selection changes do not affect running operation.
- replace controls other than the current submit remain usable during replace.
- unreview all does not globally disable marker buttons.
- clear translations handles queued row writes predictably.
- row delete queues behind existing row writes or cancels them according to chosen policy.
- target language manager queues after dirty row operations.
- navigation enqueues dirty saves and proceeds when queue owns the work.
- background sync defers until queue drains.
- project refresh/import/lifecycle operations do not run concurrently with queued editor commits for the same repo.
- run-time permission denial prevents large-operation Tauri commands from being invoked.

## Acceptance Criteria
- Large operations no longer globally lock unrelated editor UI.
- Each operation has clear target capture semantics.
- Failures are operation-scoped.
- `npm test` passes.
