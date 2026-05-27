# Editor Operation Queue Test Plan

## Goal
Provide a regression matrix that prevents the editor from drifting back into UI locks or stale async state bugs while the operation queue is implemented incrementally.

## Test Layers

1. Queue unit tests
   - Test `repo-write-queue.js` and `editor-operation-queue.js` without editor UI.

2. State reducer/helper tests
   - Test marker/style/text/comment/image optimistic state helpers.

3. Flow tests
   - Test editor flow functions such as marker toggle, text style, row persist, comments, images, replace.

4. Render/source tests
   - Ensure controls are not rendered `disabled` solely because save/commit state is pending.

5. Integration-style app tests
   - Use existing Node tests to simulate state transitions across editor screen models and render output.

6. Projects page queue tests
   - Test Projects page refresh/write UI against shared `repoWriteQueue` snapshots.

## Queue Unit Tests
Required tests:
- same chapter scope runs serially,
- different chapter scopes in the same repo scope still run serially,
- different repo scopes can run concurrently,
- queued operation with same `coalesceKey` is replaced by latest,
- running operation with same `coalesceKey` is not cancelled,
- stale success does not apply,
- stale failure does not rollback newer local state,
- latest failure calls `onError`,
- queue continues after non-halting failure,
- `flushEditorOperationQueue` waits for queued and running operations,
- render notifications include requested scopes.
- shared `repoWriteQueue` serializes editor writes, project sync, imports, and lifecycle operations for the same repo.
- run-time permission denial prevents the queued command body from executing.
- project `repoScope` helper returns identical scopes for editor and Projects page operations.
- fallback repo scopes are used for repair/rebuild/re-clone when local repo data is missing.

## Marker Regression Tests
Required tests:
- `Please check` button is not disabled while marker save is pending.
- Clicking `Please check` twice before first command resolves ends unchecked.
- Clicking `Reviewed` repeatedly settles to latest state.
- Marker toggle while row text save is pending remains clickable.
- Marker toggle while style save is pending remains clickable.
- Marker toggle while comments are saving remains clickable.
- stale marker success cannot overwrite newer local marker state.
- latest marker failure rolls back or marks error according to chosen policy.
- final marker command payload/repo row state matches the latest local marker intent.
- marker operations do not run concurrently with row text commits for the same repo.
- marker controls remain interactive while row text saves are queued or running.
- queued marker run-time permission denial does not invoke Tauri.

## Text Style Regression Tests
Required tests:
- style buttons are not disabled while style save is pending.
- rapid style changes coalesce to latest style.
- style change while row text save is pending remains clickable.
- style change while marker save is pending remains clickable.
- stale style success cannot overwrite newer local style.
- style change updates Review tab current text behavior.
- final style command payload/repo row state matches the latest local style intent.
- style operations do not run concurrently with row text or marker commits for the same repo.
- style controls remain interactive while row text and marker saves are queued or running.
- queued style run-time permission denial does not invoke Tauri.

## Row Text Regression Tests
Required tests:
- row text edits remain immediate.
- row text save operation captures full command input before navigation.
- editing while save is running queues latest text.
- older save success does not clear dirty state for newer text.
- conflict response still produces conflict state.
- permission denial locks failed row without trapping navigation.
- durable flush waits for queue drain.
- UI-friendly flush enqueues and continues.
- completion after navigation invalidates/refetches the correct chapter and does not mutate a newly opened chapter with matching row ids.
- background sync waits for the shared `repoWriteQueue` lane for that repo.
- final row JSON/command payload matches the latest local text intent.

## Comments Regression Tests
Required tests:
- comment save can begin while row text save is pending.
- comment delete can begin while marker save is pending.
- failed comment add is visible with error or restored to draft.
- stale comment result cannot overwrite newer comment state.
- comment count/revision reconciles on success.

## Image Regression Tests
Required tests:
- image URL update can begin while marker save is pending.
- image remove can begin while row text save is pending.
- upload pending state does not disable unrelated controls.
- upload queues an app-staged file path, not a temporary picker reference.
- latest image failure restores previous image state.
- stale image failure does not rollback newer image state.
- queued comment/image run-time permission denial does not invoke Tauri.

## Large Operation Regression Tests
Required tests:
- replace selected captures row ids at enqueue time.
- changing selection during replace affects only future replace.
- replace submit pending does not disable unrelated editor controls.
- unreview all does not globally disable row marker buttons.
- clear translations has operation-scoped loading/error state.
- row delete target semantics are deterministic with queued row writes.
- target language manager queues behind dirty row saves.
- background sync defers while queue has local writes.
- navigation can proceed after queue owns dirty row saves.
- project refresh/import/lifecycle operations do not run concurrently with queued editor commits for the same repo.
- queued large-operation run-time permission denial does not invoke Tauri.

## Projects Page Regression Tests
Required tests:
- project refresh queues behind editor writes for the same repo.
- project refresh for a different repo can run while an editor write is queued.
- whole-page refresh fans out by repo and only waits for repos with pending writes.
- add files/import uses `repoWriteQueue`.
- chapter rename/delete/restore uses `repoWriteQueue`.
- glossary selector changes use `repoWriteQueue`.
- repair/rebuild/re-clone uses `repoWriteQueue`.
- conflicted repo overwrite/recovery uses `repoWriteQueue`.
- repair/rebuild/re-clone uses fallback repo scope when the local repo is missing.
- export/download waits during active repo writes and durable-flushes when queued editor writes must be included.
- same-repo project action ordering covers coalesce, queue, supersede, and block cases.
- Projects refresh spinner/status distinguishes queued-behind-local-saves from active refresh/sync.
- unrelated project cards remain interactive while one repo has queued work.
- refresh result does not clear pending lifecycle intent from queued project/chapter mutation.
- editor write success publishes project/chapter invalidation keys for Projects page refresh.
- editor write failure after leaving editor records durable queue error keyed by repo/project/chapter/row.
- export requiring durable state waits for queued editor writes before reading repo contents.
- editor write failure after returning to Projects shows a notice without globally locking Projects page.

## Render Lock Regression Tests
Search render output for accidental pending-save disabling:
- marker buttons should not include `disabled` because `markerSaveState.status === "saving"`.
- style buttons should not include `disabled` because `textStyleSaveState.status === "saving"`.
- replace row selection should not be disabled only because replace is saving, unless the current sub-plan explicitly keeps that one operation-specific lock.
- unrelated toolbar buttons should stay enabled during pending row saves.
- Projects page actions for unrelated repos should stay enabled while one repo has queued work.

## Commands To Run
After each sub-plan:
- `npm test`
- focused test files touched by the slice.

Before release:
- `npm test`
- `git diff --check`

Run `cargo test` only if Tauri command contracts or Rust validation change.
