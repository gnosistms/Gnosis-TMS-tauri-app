# Projects Page Repo Write Queue Plan

## Goal
Integrate the Projects page with the shared `repoWriteQueue` so project repo operations cannot race editor commits. The Projects page should show accurate queue-aware status, keep safe UI actions responsive, and avoid using one-off bridge guards.

This plan is required because the editor operation queue relies on project refresh/sync/import/lifecycle operations sharing the same repo-level serialization model.

## Files To Touch
- `src-ui/app/repo-write-queue.js`
- `src-ui/app/project-chapter-flow.js`
- `src-ui/app/project-discovery-flow.js`
- `src-ui/app/project-flow.js`
- `src-ui/app/project-write-coordinator.js`
- `src-ui/app/project-repo-sync-flow.js`
- `src-ui/app/project-repo-sync-shared.js`
- `src-ui/app/resource-page-controller.js`
- `src-ui/screens/projects.js`
- Tests:
  - `src-ui/app/project-chapter-flow.test.js`
  - `src-ui/app/project-discovery.test.js`
  - `src-ui/app/project-repo-sync-shared.test.js`
  - `src-ui/app/resource-page-controller.test.js`
  - `src-ui/screens/projects.test.js`
  - `src-ui/app/repo-write-queue.test.js`

## Repo Scope Resolution
Add a shared helper for building project repo scopes, either in `repo-write-queue.js` or a small project repo helper:

- input: selected team, project id, project repo name.
- output: `repoScope = installationId:projectId:repoName`.
- return a fallback scope when the local project repo is missing or uncertain:
  - preferred fallback: `installationId:projectId` when project id is known,
  - secondary fallback: `installationId:repoName` when repo name is known but project id is not,
  - team-level fallback: `installationId:projects` for repo creation, repair scans, or operations that can affect multiple project repos.
- return `null` only for operations that are truly team metadata-only and cannot touch a project repo now or as part of the same flow.

Use the same scope format from the editor queue so editor operations and Projects page operations serialize against each other.

Repair/rebuild/re-clone and conflicted repo recovery must never skip the queue because the local repo is missing. Those operations should use the best available fallback scope.

## Projects Page Operation Inventory
Operations that must enter `repoWriteQueue` when they touch a project repo:

- project repo refresh/pull/sync,
- background project repo sync,
- add files / import files into a project,
- chapter rename,
- chapter soft-delete,
- chapter restore,
- chapter local hard-delete when it mutates local repo state,
- glossary selector / chapter glossary link changes,
- add translation to a chapter,
- clear deleted files if it mutates local project repo state,
- repair/rebuild/re-clone local project repo,
- overwrite/recover conflicted project repo,
- project lifecycle actions that mutate local repo state,
- any project export path that requires pending local editor writes to be durable first.

Operations that probably do not need `repoWriteQueue`:

- pure UI modal open/close,
- local-only project list filtering/expansion,
- team metadata-only writes, unless they are immediately paired with project repo mutation.

Read-only downloads/exports are handled separately below because they are safe only when they avoid reading during active repo mutation.

## Queue Wrapping Pattern
Use `withRepoWriteQueue(repoScope, async () => { ... })` for existing project flows during migration.

For each wrapped operation:
- compute `repoScope` before starting the write,
- set Projects page operation status to queued/running based on queue snapshot,
- run the existing Tauri command inside the queue callback,
- refresh/invalidate project data after success,
- surface operation-scoped errors through existing notices/modals.

Do not let wrapped operations also perform separate "wait for editor queue" checks. The shared queue is the synchronization mechanism.

## Project Refresh And Sync
Refresh/pull behavior should be queue-aware:

- A project refresh for a repo with queued editor writes should enter the same `repoWriteQueue` behind those writes.
- While waiting, show a status such as `Waiting for local saves...` or include pending local saves in the existing Projects status surface.
- Once the refresh operation reaches the front of the queue, show the normal sync/refresh message.
- Refresh should not cancel or overwrite queued editor writes.
- Refresh results should not erase optimistic project/chapter lifecycle intents that are still queued.

If refresh is purely a disk rescan and does not invoke Git or mutate repo state, it may run outside the write queue, but it must not present stale repo data as final while queued writes for that repo remain.

Whole-page refresh should fan out by repo scope:
- visible project repos with no queued/running writes may refresh immediately,
- a repo with queued/running editor writes waits behind that repo's queue,
- unrelated project repos should not wait behind another repo's pending editor save,
- the page-level spinner/status should aggregate partial refresh state, for example `Refreshing 3 projects; waiting for local saves in 1 project`.

When a team-level metadata refresh is part of Projects page refresh:
- metadata-only network reads may run outside individual repo scopes,
- any metadata write paired with project repo repair or lifecycle mutation must use the relevant repo or team fallback scope,
- final visible project state should merge per-repo refresh results without clearing pending queued intents.

## Read, Download, And Export Behavior
Reads that inspect project repo contents must not read while a write for the same repo is actively mutating the worktree.

Rules:
- If the export/download should include queued editor writes, call a durable flush for the affected repo scope and wait for the queue to drain before reading.
- If the export/download does not need queued editor writes, it may proceed only when no write is currently running for that repo. Queued-but-not-running writes can be left queued if the user explicitly wants the current committed state.
- If a write is running, wait for that running operation to finish or read from a known immutable snapshot. The first implementation should wait; do not introduce snapshot export unless there is an existing safe snapshot mechanism.
- The UI should show an export/download status like `Waiting for local saves...` instead of silently producing stale or partially mutated output.
- Tests should cover reads waiting during active repo writes.

## Project Page UI State
Update Projects page state derivation so queue state is visible but not overly blocking.

Recommended behavior:

- Refresh spinner:
  - spins while a Projects page refresh/sync operation is queued or running for visible project repos,
  - can show a different status line for `queued behind local saves` vs `syncing`.

- Status badges:
  - lower-right status should identify queue wait and active repo operation separately when useful,
  - existing sync issue/error messages should remain visible.

- Action disabling:
  - disable actions that mutate the same repo while another non-coalescible mutation for that repo is queued/running,
  - keep unrelated project cards/actions enabled,
  - keep safe UI actions enabled, such as expand/collapse, open file, download/export reads that do not need durable pending writes,
  - if an export must include queued editor saves, make it wait via durable flush rather than silently exporting stale content.

- Page-level `writeState`:
  - should not be the only source of truth once queue state exists,
  - derive disabled/spinner status from both existing `projectsPage` state and `repoWriteQueueSnapshot`.

## Same-Repo Action Ordering
Classify same-repo project actions before implementation. Default rules:

- Coalesce latest:
  - repeated glossary selector changes for the same chapter,
  - repeated rename submissions for the same chapter before the first rename starts,
  - repeated refresh requests for the same repo.

- Queue in order:
  - add files/import behind rename/restore/refresh,
  - refresh behind local writes,
  - repair/rebuild behind active local writes unless repair is explicitly resolving the failed repo state,
  - export/download behind active writes when it needs durable content.

- Supersede/cancel pending operations:
  - chapter soft-delete supersedes a queued chapter rename for the same chapter,
  - chapter local hard-delete supersedes queued glossary selector changes for that chapter,
  - project lifecycle delete/restore supersedes queued child-level mutations that are no longer valid.

- Block with a clear message:
  - add files/import while project is soft-deleted/read-only,
  - glossary selector changes while project or chapter is soft-deleted/read-only,
  - repair/rebuild while another repair/rebuild for the same fallback scope is running,
  - destructive lifecycle actions when required confirmation is missing.

If an action is not classified, choose queue-in-order for data safety and add a test.

## Interaction With Editor Queue
When the user leaves the editor and returns to Projects:

- queued editor row text/marker/style writes continue in `repoWriteQueue`,
- Projects page refresh for that same repo waits behind those writes,
- when queued editor writes complete, invalidate or refresh the affected project/chapter data through the concrete invalidation rules below,
- Projects page should not show stale chapter metadata as final if queue writes are pending for that repo.

If an editor write fails after the user is on Projects:
- show a lower-right notice badge,
- mark the affected project/chapter with an error or pending-save issue if practical,
- do not globally lock the Projects page.

## Invalidation And Cache Rules
Queued editor writes and Projects page repo writes should publish explicit invalidation events.

Invalidation keys:
- `projectRepo:${repoScope}` for repo-level file listings and sync state,
- `project:${projectId}` for project card summary and chapter list,
- `chapter:${projectId}:${chapterId}` for one chapter/file row,
- `editorChapter:${repoScope}:${chapterId}` for editor row data,
- `projectCache:${teamId}` for persisted Projects page cache after successful refresh.

On queued editor write success:
- invalidate `chapter:${projectId}:${chapterId}`,
- invalidate `editorChapter:${repoScope}:${chapterId}`,
- update or refetch project file listing if visible on Projects,
- preserve queued lifecycle/glossary/import intents already present in `state.projects`,
- write persistent project cache only after refreshed data is merged with pending intents.

On Projects page repo write success:
- invalidate/refetch `projectRepo:${repoScope}`,
- refresh the affected project/chapter listing,
- preserve unrelated editor optimistic state if the editor is open.

On queue failure:
- do not invalidate as if success occurred,
- record a durable queue error as described below,
- keep existing optimistic intent visible with an error state until user action or next successful refresh resolves it.

If Projects page is not visible:
- record invalidation keys and apply them on next Projects page load,
- do not force a full page render solely for hidden Projects state.

## Durable Queue Errors
Add a queue error bucket outside transient editor state, keyed by operation target:

- `repoScope`
- `projectId`
- `chapterId`
- `rowId` when applicable
- `operationId`
- `kind`
- `message`
- `createdAt`
- `sourceScreen`: `editor` or `projects`

Use this bucket when an editor write fails after the user has left the editor.

Projects page behavior:
- show a lower-right badge for new failures,
- surface an inline project/chapter issue when the target project/chapter is visible,
- avoid attaching the error to a different project/chapter that happens to reuse a row id,
- clear the error when a retry succeeds, the resource is refreshed and no longer pending, or the user dismisses a purely informational notice.

## TanStack Query / Page Refresh
If the current project discovery/page refresh flow uses TanStack Query or query-core wrappers, integrate at invalidation boundaries:

- queue success should invalidate/refetch project data for the affected repo,
- queue failure should not invalidate as if success occurred,
- query `isFetching` should not be used as a substitute for repo write queue status,
- queue status should remain the source of truth for local Git write serialization.

## Tests
Add tests for:

- project refresh waits behind a queued editor write for the same repo,
- project refresh for a different repo can run while an editor write is queued,
- whole-page refresh fans out by repo and only waits for repos with pending writes,
- add files/import runs through `repoWriteQueue`,
- chapter rename/delete/restore runs through `repoWriteQueue`,
- glossary selector changes run through `repoWriteQueue`,
- fallback scope is used for repair/rebuild/re-clone when local repo data is missing,
- read/export waits during active repo writes and optionally durable-flushes queued writes,
- same-repo action ordering follows the coalesce/queue/supersede/block matrix,
- Projects refresh spinner/status reflects queued vs running repo work,
- unrelated project cards remain interactive while one repo has queued work,
- refresh result does not clear pending lifecycle intent from queued project/chapter mutation,
- successful editor writes publish project/chapter invalidation keys,
- failed editor writes after leaving the editor land in durable queue error state,
- export requiring durable state waits for queued editor writes,
- queued editor write failure after returning to Projects shows a notice without globally locking the page.

## Acceptance Criteria
- All project repo writes use `repoWriteQueue`.
- Projects page status accurately distinguishes waiting local saves from active refresh/sync.
- Editor writes and Projects page repo operations cannot run concurrently for the same repo.
- Unrelated project repo operations can still run concurrently.
- `npm test` passes.
