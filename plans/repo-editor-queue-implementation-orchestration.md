# Repo And Editor Queue Implementation Orchestration

## Goal
Coordinate implementation of the shared `repoWriteQueue`, Projects page integration, and optimistic editor operations in safe stages. Each stage should have clear scope, explicit non-goals, and go/no-go tests before moving to the next stage.

## Source Plans
- `plans/editor-operation-queue-plan.md`
- `plans/editor-operation-queue-foundation-plan.md`
- `plans/project-page-repo-write-queue-plan.md`
- `plans/editor-queued-row-text-save-plan.md`
- `plans/editor-optimistic-markers-plan.md`
- `plans/editor-optimistic-text-style-plan.md`
- `plans/editor-optimistic-comments-images-plan.md`
- `plans/editor-large-operations-queue-plan.md`
- `plans/editor-operation-queue-test-plan.md`

## Guiding Rules
- Do not remove editor UI locks before the repo write queue owns the relevant write path.
- Do not allow two Git-writing operations for the same project repo to run concurrently.
- Prefer narrow, shippable stages over one large rewrite.
- Preserve existing conflict detection and read-only/viewer protection throughout.
- Every queued write must re-check current write permission immediately before invoking Tauri.
- If implementation discovers an unplanned repo write path, update the relevant detailed plan before converting it.
- Queue status may supplement TanStack/query status, but query `isFetching` must not substitute for repo write serialization state.
- `npm test` must pass before moving to the next stage.

## Stage 1: Foundation Only
Primary plans:
- `plans/editor-operation-queue-foundation-plan.md`
- `plans/editor-operation-queue-test-plan.md`

Implement:
- `src-ui/app/repo-write-queue.js`
- `src-ui/app/repo-write-queue.test.js`
- `src-ui/app/editor-operation-queue.js`
- `src-ui/app/editor-operation-queue.test.js`
- shared project repo scope helper, including fallback scopes for missing local repos,
- queue snapshot APIs for screen state derivation,
- durable queue error and invalidation event primitives, if they are not already represented cleanly in app state.

Do not:
- change visible editor behavior,
- remove disabled states,
- change Projects page action behavior,
- convert row text saves yet.

Go/no-go:
- repo queue serializes same-repo writes,
- different repo scopes can run concurrently,
- editor operation queue coalesces stale intents,
- run-time permission denial prevents queued command execution,
- fallback scopes are stable for missing repo, repo-name-only, and team-level operations,
- queue snapshots expose enough state for Projects page spinner/status without peeking into internal promises,
- `npm test` passes.

## Stage 2: Projects Page Queue Integration
Prerequisite:
- Stage 1 complete.

Primary plan:
- `plans/project-page-repo-write-queue-plan.md`

Implement:
- Projects page repo scope usage.
- Wrap project refresh/pull/sync in `repoWriteQueue`.
- Wrap add files/import, chapter lifecycle operations, glossary selector changes, repair/rebuild/re-clone, and conflicted repo recovery.
- Queue-aware Projects page spinner/status.
- Durable read/export handling during active repo writes.
- Durable cross-page queue error bucket.
- Project/chapter invalidation keys after queued write success.
- Whole-page refresh fan-out by repo scope.
- Same-repo action ordering rules for coalesce, queue-in-order, supersede, and block cases.

Do not:
- change editor marker/style behavior yet,
- change row text save ownership yet,
- make editor controls optimistic yet.

Go/no-go:
- Projects page refresh waits behind queued editor/repo writes for the same repo.
- Whole-page refresh fans out by repo.
- Unrelated project actions stay enabled.
- Same-repo actions follow coalesce/queue/supersede/block rules.
- Exports do not read during active repo writes.
- Repair/rebuild/re-clone and conflicted-repo recovery use fallback queue scopes instead of bypassing the queue when the local repo is missing.
- Successful queued writes publish concrete invalidation keys.
- Failed queued writes land in durable queue error state without globally locking Projects.
- Project and screen tests pass.
- `npm test` passes.

## Stage 3: Editor Row Text Queue
Prerequisite:
- Stage 2 complete, so Projects page refresh/sync/import/lifecycle operations share the same repo queue that editor row text saves will use.

Primary plan:
- `plans/editor-queued-row-text-save-plan.md`

Implement:
- Move row text save/commit behavior into editor operation queue and `repoWriteQueue`.
- Preserve dirty row tracking.
- Preserve conflict detection and conflict UI.
- Store complete command input before navigation.
- Add chapter/project invalidation when queued saves finish after navigation.
- Make editor-triggered background sync wait for `repoWriteQueue` instead of using separate bridge guards.

Do not:
- remove marker/style UI locks yet,
- convert comments/images yet,
- convert large editor operations yet.

Go/no-go:
- row text edits remain immediate,
- save while editing queues latest text,
- stale save success does not clear newer dirty text,
- conflict response still opens conflict state,
- navigation does not lose dirty text after queue ownership,
- run-time permission denial does not trap navigation,
- Projects page reflects completed queued row text writes through invalidation if the user navigates away before completion,
- row persistence/background sync/navigation tests pass,
- `npm test` passes.

## Stage 4: Optimistic Markers
Prerequisite:
- Stage 3 complete, because marker operations must overlap safely with queued/running row text saves from their first release.

Primary plan:
- `plans/editor-optimistic-markers-plan.md`

Implement:
- Convert `Reviewed` and `Please check` to queued optimistic operations.
- Remove marker button disabled state caused by marker save.
- Coalesce repeated marker clicks.
- Allow marker toggles while row text saves are queued/running.
- Ignore stale marker success/failure.

Do not:
- convert text style yet unless marker behavior is stable,
- convert comments/images yet.

Go/no-go:
- user can click and immediately unclick `Please check`,
- latest marker intent wins in UI and final persisted command/repo state,
- marker command does not run concurrently with row text commits for same repo,
- run-time permission denial prevents marker Tauri command,
- stale marker success/failure cannot overwrite a newer marker intent,
- marker tests pass,
- `npm test` passes.

## Stage 5: Optimistic Text Style
Prerequisite:
- Stage 4 complete and stable.

Primary plan:
- `plans/editor-optimistic-text-style-plan.md`

Implement:
- Convert text style buttons to queued optimistic operations.
- Remove style button disabled state caused by style save.
- Coalesce rapid style changes.
- Allow style changes while row text and marker saves are queued/running.
- Update Review tab current text behavior for optimistic style changes.

Do not:
- convert comments/images yet,
- convert large editor operations yet.

Go/no-go:
- latest style intent wins in UI and final persisted command/repo state,
- style command does not run concurrently with row text or marker commits for the same repo,
- stale style success/failure cannot overwrite newer style,
- Review tab reflects optimistic style change,
- style tests pass,
- `npm test` passes.

## Stage 6: Comments And Images
Prerequisite:
- Stage 5 complete and stable.

Primary plan:
- `plans/editor-optimistic-comments-images-plan.md`

Implement:
- Queue comment add/delete.
- Queue image URL/upload/remove.
- Stage upload files in an app-controlled path before enqueue.
- Add scoped rollback/error behavior for comments and images.

Do not:
- convert large editor operations until comment/image rollback is stable.

Go/no-go:
- comments/images can be changed while row text/marker/style saves are queued,
- failed comment/image operations remain scoped to the affected row/action,
- upload queue uses staged file paths, not temporary picker references,
- stale image failure does not rollback newer image state,
- failed staged uploads are cleaned up or marked for cleanup without losing the user's visible intent,
- run-time permission denial prevents comment/image Tauri commands,
- comment/image tests pass,
- `npm test` passes.

## Stage 7: Large Editor Operations
Prerequisite:
- Stage 6 complete and stable.

Primary plan:
- `plans/editor-large-operations-queue-plan.md`

Implement queue-aware behavior for:
- replace selected,
- unreview all,
- clear translations,
- batch replace undo,
- restore from history,
- soft-delete/restore row,
- target language manager.

Do not:
- make structural delete/restore aggressively optimistic until rollback semantics are clear.

Go/no-go:
- operations capture target sets at enqueue time,
- unrelated editor controls stay enabled,
- operation-specific errors stay scoped,
- background sync defers while queue has local writes,
- structural operations that supersede pending row operations explicitly cancel or mark those pending operations stale,
- large operation tests pass,
- `npm test` passes.

## Stop Conditions
Pause implementation and update the relevant plan if any stage reveals:
- a Git-writing Tauri command that cannot be scoped to a repo or team fallback scope,
- an editor or Projects operation that reads mutable repo contents during an active write without a safe wait/snapshot path,
- a failure mode where stale success can clear newer optimistic state,
- a permission or read-only path that cannot be re-checked immediately before the queued command runs,
- tests that require broad fixture rewrites unrelated to the queued behavior.

## Release Notes Discipline
Each stage should be independently releasable. Release notes should state:
- what write path moved into the queue,
- what UI locks were removed,
- known remaining locks that are intentionally deferred,
- any changed failure/retry behavior.
