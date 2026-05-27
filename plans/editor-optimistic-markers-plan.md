# Editor Optimistic Markers Plan

## Goal
Make `Reviewed` and `Please check` buttons fully optimistic. Users should be able to click, unclick, and click again while a previous marker save/commit is still pending. The latest local marker state should win.

This phase assumes row text commits are already queue-owned and that all project repo writes use the shared `repoWriteQueue`. The selected rollout is full overlap support: marker clicks should remain interactive even while row text saves are queued or running.

## Current Problem
Marker controls are blocked in two places:
- The marker button renders `disabled` when `markerSaveState.status === "saving"`.
- `toggleEditorRowFieldMarker` refuses to run while row text, marker, style, comments, or other dirty rows are pending.

## Files To Touch
- `src-ui/app/editor-persistence-flow.js`
- `src-ui/app/editor-persistence-state.js`
- `src-ui/app/editor-row-render.js`
- `src-ui/app/editor-screen-model.js` if needed for pending marker display.
- `src-ui/app/editor-write-guards.test.js`
- `src-ui/app/editor-persistence-state.test.js`
- `src-ui/screens/translate-source.test.js` or another render/source test for the disabled attribute.

## Behavior
On marker click:
1. Determine current displayed marker state from `row.fieldStates[languageCode]`.
2. Compute the next desired state.
3. Apply it to `row.fieldStates` immediately.
4. Mark the row/action as marker pending visually, but do not disable the button.
5. Enqueue a coalesced marker operation with key:
   - `marker:${chapterId}:${rowId}:${languageCode}:${kind}`
6. If another queued marker operation with the same key exists, replace it with the latest desired state.
7. If an older operation is already running, let it finish but treat its result as stale if a newer intent version exists.

## Operation Payload
The queued marker operation should capture:
- `rowId`
- `languageCode`
- `kind`: `reviewed` or `please-check`
- `enabled`: latest desired boolean
- `previousFieldState`: state before the latest local intent
- `intentVersion`
- `repoScope`
- `chapterScope`
- `rowScope`
- `coalesceKey`

## Optimistic State Shape
Extend `markerSaveState` or replace it with a marker intent summary that can represent multiple languages/kinds.

Minimum acceptable shape:
- `status`: `idle` or `saving`
- `languageCode`
- `kind`
- `intentVersion`
- `error`

Better shape:
- `pendingMarkersByKey`: object keyed by `languageCode:kind`
- each entry has `intentVersion`, `enabled`, `status`, and `error`

The better shape avoids one marker operation hiding another if a row has multiple target languages visible.

## Success Handling
On success:
- Ignore payload if operation is stale.
- If latest:
  - update `persistedFieldStates[languageCode]`,
  - update `lastUpdate`,
  - update `chapterBaseCommitSha`,
  - clear the pending marker entry,
  - reconcile dirty tracking only for the marker intent, not unrelated dirty text.

Important: success from an older `enabled: true` operation must not overwrite a newer local `enabled: false` state.

## Failure Handling
On failure:
- If stale, show a lower-right badge only if useful, but do not rollback current marker state.
- If latest:
  - restore `previousFieldState`, or keep the desired state with an inline error if rollback feels worse.
  - Preferred first implementation: rollback latest failed marker to previous persisted state and show badge.
  - Store error in the marker pending/error state so the row can display failure context.

## Removed Blocks
Remove or relax:
- `disabled` attribute from marker buttons when marker save is pending.
- `row.markerSaveState?.status === "saving"` early return for repeated marker clicks.
- Blocking marker toggles only because row text save is queued or running.
- Blocking marker toggles only because text style save is queued or running.
- Blocking marker toggles only because comments are saving after comments are queue-owned.

Keep:
- permission/read-only checks,
- soft-deleted checks,
- conflict/remotely deleted checks unless there is a clear merge path,
- session write permission assertion before optimistic enqueue,
- current write permission assertion immediately before the queued operation invokes the Tauri command.

## Interaction With Row Text Saves
Do not call `flushDirtyEditorRows` before a marker toggle. The shared `repoWriteQueue` will serialize commit-producing operations at `repoScope`.

If row text save is already running:
- marker intent should still apply locally,
- marker command waits behind the running commit in the queue,
- marker command reads current row JSON when it runs and applies the flag update then.

## Tests
Add tests for:
- `Please check` button does not render `disabled` while marker save is pending.
- Clicking `Please check` twice while first save is pending ends with unchecked local state.
- Coalesced queued marker operation saves only the latest desired state.
- Older success payload does not overwrite newer marker state.
- Older failure does not rollback newer marker state.
- Latest failure rolls back or marks marker error according to the chosen policy.
- Marker can be toggled while row text save is pending.
- Marker can be toggled while text style save is pending.
- Marker can be toggled while comments are saving.
- Marker command re-checks current write permission at run time and does not invoke Tauri if the user became a viewer while queued.
- Final persisted command payload/repo state matches the latest marker intent, not just the UI state.

## Acceptance Criteria
- The user can immediately unclick `Please check` after clicking it.
- No marker button is disabled only due to marker save state.
- Latest marker intent wins.
- No marker operation can run concurrently with another commit-producing operation for the same repo.
- Marker toggles remain interactive while row text saves are queued or running.
- `npm test` passes.
