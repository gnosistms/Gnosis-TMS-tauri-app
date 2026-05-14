# Top-Level Query Mutation Flow Plan

## Goal

Stop top-level pages from briefly reverting lifecycle changes when stale cache, local disk, or remote refresh data arrives after a user action.

The immediate visible bug is Glossaries soft-delete: a glossary moves to deleted, jumps back to undeleted, then moves down again. The same architecture risk applies to QA Lists, and parts of Projects.

The fix should make TanStack Query the single in-memory update pipeline for Projects, Glossaries, and QA Lists.

## Current Diagnosis

### Glossaries

- Glossaries already have a query layer in `src-ui/app/glossary-query.js`.
- The page still performs lifecycle writes through custom direct state/query patching in `src-ui/app/glossary-lifecycle-flow.js`.
- `deleteGlossary()` uses `requestGlossaryWriteIntent()` instead of a TanStack mutation.
- `applyGlossaryPatchToQueryAndState()` manually patches query data and app state.
- `loadTeamGlossaries()` can seed cache/local data during a background refresh in `src-ui/app/glossary-discovery-flow.js`.
- `glossarySyncVersion` guards some stale loads, but lifecycle writes do not consistently advance that version, so an in-flight refresh can still apply stale lifecycle state after a delete or restore.

### QA Lists

- QA Lists are likely vulnerable to the same bug.
- The current QA list flow is modeled after Glossaries, but it does not yet have a mature TanStack Query layer.
- Direct state and persistent-cache writes can race with refresh results.

### Projects

- Projects have a stronger query layer in `src-ui/app/project-query.js`.
- Mutation option helpers exist for rename, soft-delete, and restore.
- Production project lifecycle paths still use custom write-intent behavior in `src-ui/app/project-flow.js`, so some real user actions can go around the query mutation path.
- Projects already have lifecycle-preservation logic, so the bug is less likely there, but the architecture is still mixed.

### Affected Actions

Soft-delete is the easiest action to notice because the item visibly jumps between active and deleted sections.

The same race can affect:

- soft-delete
- restore
- rename
- permanent delete
- create
- import
- make default / make active style metadata changes

## Reviewed Code Hotspots

The plan should be implemented against these concrete files and functions.

### Query Infrastructure

- `src-ui/app/query-client.js` exports `queryClient`, `subscribeQueryObserver()`, and `createMutationObserver()`.
- Existing query keys are `projectKeys.byTeam(teamId)` and `glossaryKeys.byTeam(teamId)`.
- QA Lists need a matching `qaListKeys.byTeam(teamId)`.

### Glossaries

- `src-ui/app/glossary-query.js` has query read support but no lifecycle mutation helpers.
- `src-ui/app/glossary-query.js` currently overlays `glossary-write-coordinator` intents in `applyGlossaryWriteIntentOverlay()`.
- `src-ui/app/glossary-discovery-flow.js` seeds from cache/local and then fetches via query.
- `src-ui/app/glossary-lifecycle-flow.js` still performs rename, soft-delete, and restore through `requestGlossaryWriteIntent()`.
- `src-ui/app/glossary-lifecycle-flow.js` contains `applyGlossaryPatchToQueryAndState()`, which is the main side path to remove for lifecycle mutations.
- `confirmGlossaryPermanentDeletion()` still uses `submitResourcePageWrite()` and reloads with `loadTeamGlossaries()`. That should be migrated after rename/delete/restore because it is a heavier flow.

### Projects

- `src-ui/app/project-query.js` already has the desired mutation pattern in `createProjectLifecycleMutationOptions()`.
- Existing project mutation helpers are:
  - `createProjectRenameMutationOptions()`
  - `createProjectSoftDeleteMutationOptions()`
  - `createProjectRestoreMutationOptions()`
- `src-ui/app/project-query.js` also has lifecycle preservation in `preserveProjectLifecyclePatchesInProjectSnapshot()`.
- Production actions in `src-ui/app/project-flow.js` still use `requestProjectWriteIntent()` for rename, soft-delete, and restore.
- The project write coordinator should remain available for chapter-level writes until those are separately migrated.

### QA Lists

- `src-ui/app/qa-list-flow.js` is currently direct-state oriented.
- `primeQaListsLoadingState()` reads persistent cache and assigns `state.qaLists`.
- `loadTeamQaLists()` assigns `state.qaLists` from storage, local disk, and remote repo metadata.
- `submitQaListRename()`, `deleteQaList()`, `restoreQaList()`, `confirmQaListPermanentDeletion()`, creation, and import all write `state.qaLists` directly.
- `src-ui/app/qa-list-cache.js` is already team-scoped through `teamCacheKey(team)`, but the page still treats it as a direct state source rather than a query seed.
- `src-ui/app/qa-list-default-flow.js` stores per-language default QA list IDs separately. This can remain separate initially, but default-changing actions should be made consistent with the query refresh flow.

## Design Principles

1. TanStack Query cache is the canonical in-memory source for top-level list pages.
2. App state is only a projection of query data.
3. Persistent cache is a fast boot source, not an independent state writer.
4. Local disk and remote refreshes return snapshots; they do not directly mutate rendered page state.
5. Lifecycle writes go through TanStack mutations.
6. Mutations cancel in-flight queries before applying optimistic updates.
7. Refresh results must preserve pending and settled lifecycle changes before they are projected to state.
8. Query keys must be scoped by selected team.
9. Any serialization needed for disk/GitHub writes should live inside mutation functions, not as a competing UI state pipeline.

## Target Data Flow

### Page Load

1. Build the team-scoped query key.
2. Seed the query from persistent cache only if the cache key matches the selected team.
3. Project query data into app state.
4. Refresh from local disk in the background.
5. Refresh from remote in the background when appropriate.
6. Every refresh writes back through `queryClient.setQueryData()`.
7. Query observers project the updated query snapshot into app state.

### Lifecycle Mutation

1. User performs an action, such as soft-delete.
2. Mutation calls `queryClient.cancelQueries()` for the team-scoped key.
3. `onMutate` snapshots previous query data.
4. `onMutate` applies the optimistic patch to query data.
5. Query observer projects the optimistic result into app state.
6. `mutationFn` writes local files and remote state as needed.
7. `onSuccess` applies the confirmed server/local result to query data.
8. `onError` restores the snapshot or marks the item with an error state.
9. `onSettled` invalidates or refreshes the query.
10. Any stale refresh that lands later is merged with lifecycle-preservation rules before projection.

## Implementation Plan

### 1. Add a Shared Mutation Pattern

Create or standardize helper functions for top-level resource mutations.

Each helper should provide:

- `mutationKey`
- `mutationFn`
- `onMutate`
- `onSuccess`
- `onError`
- `onSettled`
- team-scoped query key lookup
- consistent snapshot/rollback behavior

If write serialization is still needed, keep it inside the mutation function. Do not allow the write coordinator to patch rendered page state independently.

Implementation detail:

- Start by copying the proven pattern from `createProjectLifecycleMutationOptions()` rather than introducing a broad abstraction immediately.
- After Glossaries and QA Lists match the same shape, extract shared code only if duplication is obvious and stable.
- Use `createMutationObserver(options).mutate()` from action handlers.
- Keep guard/modal/permission logic in the existing flow files. Only move query patching, rollback, and invalidation into query mutation helpers.
- Use mutation `scope: { id: "team-metadata:<installationId>" }` for top-level metadata writes so same-team lifecycle writes are serialized.
- If a lower-level queue is still needed for a GitHub/local write, call it inside `mutationFn`; it must not call `setQueryData()`, assign `state.*`, or persist cache itself.

### 2. Fix Glossaries First

Add TanStack mutation option helpers for glossary lifecycle actions:

- rename glossary
- soft-delete glossary
- restore glossary
- permanent delete glossary
- make default glossary
- create/import glossary where practical

Move the current optimistic patch behavior from `glossary-lifecycle-flow.js` into mutation handlers.

Replace production calls to `requestGlossaryWriteIntent()` for top-level glossary lifecycle actions with TanStack mutations.

Add lifecycle-preservation logic similar to Projects:

- If a query snapshot says an item has a pending or settled local lifecycle change, stale local/remote snapshots cannot undo it.
- Background refreshes may add newer metadata, but they cannot revive a locally soft-deleted item.

Keep `glossarySyncVersion` only as a broad stale-load guard. Do not rely on it as the primary mutation consistency mechanism.

Implementation detail:

In `src-ui/app/glossary-query.js`, add these helpers:

- `moveGlossaryToLifecycle(queryData, glossaryId, lifecycleState, patch = {})`
- `glossaryLifecycleIntent(glossary)`
- `glossaryLocation(snapshot, glossaryId)`
- `glossaryTitleInSnapshot(snapshot, glossaryId)`
- `preserveGlossaryLifecyclePatchesInSnapshot(nextSnapshot, previousSnapshot)`
- `preservePendingGlossaryLifecyclePatches(nextSnapshot, previousSnapshot)`
- `createGlossaryLifecycleMutationOptions(...)`
- `createGlossaryRenameMutationOptions(...)`
- `createGlossarySoftDeleteMutationOptions(...)`
- `createGlossaryRestoreMutationOptions(...)`

The glossary preservation logic should mirror Projects:

- `pendingMutation: "softDelete"` or `localLifecycleIntent: "softDelete"` keeps the glossary deleted when stale refresh data still says active.
- `pendingMutation: "restore"` or `localLifecycleIntent: "restore"` keeps the glossary active when stale refresh data still says deleted.
- `pendingMutation: "rename"` or `localLifecycleIntent: "rename"` keeps the new title when stale refresh data still has the old title.

Update these paths in `src-ui/app/glossary-query.js` to preserve lifecycle patches:

- `seedGlossariesQueryFromCache()`
- `seedGlossariesQueryFromLocal()`
- `createGlossariesQueryOptions().queryFn`

For those functions, the merge shape should be:

```js
const previousQueryData = queryClient.getQueryData(glossaryKeys.byTeam(teamId));
const nextSnapshot = createGlossariesQuerySnapshot(...);
return preservePendingGlossaryLifecyclePatches(nextSnapshot, previousQueryData);
```

Then remove lifecycle dependence on `applyGlossaryWriteIntentOverlay()` for top-level rename/delete/restore. If `glossary-write-coordinator` is still needed for repo sync, keep it limited to repo sync and do not let it override top-level lifecycle state.

In `src-ui/app/glossary-lifecycle-flow.js`:

- Keep `guardTopLevelResourceAction()`, `ensureGlossaryNotTombstoned()`, permission checks, modals, and user-visible errors.
- Replace `requestGlossaryWriteIntent()` in `submitGlossaryRename()`, `deleteGlossary()`, and `restoreGlossary()` with `createMutationObserver(createGlossary*MutationOptions(...)).mutate()`.
- Reuse `commitGlossaryMutationStrict()` as the mutation `commitMutation`.
- Move optimistic patching out of `applyGlossaryPatchToQueryAndState()`.
- Delete `applyGlossaryPatchToQueryAndState()` after no production lifecycle path uses it.
- Persist the glossary cache after successful query mutation projection, not before the mutation has settled.
- Keep `state.showDeletedGlossaries = true` as an `onOptimisticApplied` side effect for soft-delete, because that is UI preference state rather than resource data.

Permanent deletion can be migrated after the basic lifecycle actions:

- Add a mutation helper that removes the glossary from query data optimistically.
- On rollback, restore the previous query data.
- On success, clear selected glossary/default state if needed, update the default glossary, and invalidate.
- Replace `reloadGlossariesAfterWrite()` with query invalidation so the permanent-delete flow does not bypass the query pipeline.

### 3. Wire Projects Production Actions Through Existing Mutations

Audit production callers in `src-ui/app/project-flow.js`.

Use existing helpers from `src-ui/app/project-query.js` for:

- rename project
- soft-delete project
- restore project

Remove or bypass duplicate direct state patches for those top-level lifecycle actions.

Keep unrelated project/chapter write flows unchanged unless they are part of the same top-level page lifecycle bug.

Implementation detail:

In `src-ui/app/project-flow.js`:

- Import `createMutationObserver` from `src-ui/app/query-client.js`.
- Import `createProjectRenameMutationOptions`, `createProjectSoftDeleteMutationOptions`, and `createProjectRestoreMutationOptions` from `src-ui/app/project-query.js`.
- Replace the `requestProjectWriteIntent()` block in `submitProjectRename()` with the rename mutation helper.
- Replace the `requestProjectWriteIntent()` block in `deleteProject()` with the soft-delete mutation helper.
- Replace the `requestProjectWriteIntent()` block in `restoreProject()` with the restore mutation helper.
- Reuse `commitProjectMutationStrict()` as `commitMutation`.
- Use `onOptimisticApplied` for UI-only side effects:
  - rename: reset the rename modal and show status text
  - delete: set `state.showDeletedProjects = true` when needed
  - all: show/clear status and notices
- Stop calling `patchProjectInVisibleState()`, `moveProjectInVisibleState()`, and `persistProjectsForTeam()` from these top-level lifecycle paths.

Keep `requestProjectWriteIntent()` for chapter title/lifecycle/glossary writes in `project-chapter-flow.js` for now. Those are a separate migration because they patch nested project data and pending chapter mutations.

### 4. Add a QA Lists Query Layer

Create `src-ui/app/qa-list-query.js` modeled on the cleaned-up glossary query layer.

Add team-scoped QA list query keys in `src-ui/app/query-client.js`.

The QA list query layer should support:

- cache seeding
- local disk refresh
- remote refresh
- lifecycle preservation
- observer-to-state projection
- mutation helpers for lifecycle actions

Rewrite QA list page loading so `state.qaLists` is updated only from query snapshots.

Rewrite QA list lifecycle actions as TanStack mutations:

- create/import
- rename
- soft-delete
- restore
- permanent delete
- make default per language

Implementation detail:

In `src-ui/app/query-client.js`, add:

```js
export const qaListKeys = {
  all: ["qaLists"],
  byTeam: (teamId) => ["qaLists", teamId ?? null],
};
```

Create `src-ui/app/qa-list-query.js` with the same public shape as glossary/project query modules:

- `createQaListsQuerySnapshot({ qaLists, syncSnapshots, discovery })`
- `applyQaListsQuerySnapshotToState(snapshot, options)`
- `seedQaListsQueryFromCache(team, options)`
- `createQaListsQueryOptions(team, options)`
- `ensureQaListsQueryObserver(render, team, options)`
- `invalidateQaListsQueryAfterMutation(team, options)`
- `patchQaListQueryData(queryData, qaListId, patch)`
- `preserveQaListLifecyclePatchesInSnapshot(nextSnapshot, previousSnapshot)`
- `createQaListRenameMutationOptions(...)`
- `createQaListSoftDeleteMutationOptions(...)`
- `createQaListRestoreMutationOptions(...)`
- `createQaListPermanentDeleteMutationOptions(...)`
- `createQaListCreateMutationOptions(...)`
- `createQaListImportMutationOptions(...)`

`applyQaListsQuerySnapshotToState()` should be the only function that assigns `state.qaLists` for the QA Lists page.

Refactor `src-ui/app/qa-list-flow.js`:

- `primeQaListsLoadingState()` should seed the query from cache instead of assigning `state.qaLists`.
- `loadTeamQaLists()` should ensure the observer, then fetch/invalidate the query.
- `setQaListsFromStorage()` should disappear or become a query seed helper.
- `submitQaListRename()`, `deleteQaList()`, and `restoreQaList()` should become mutation calls.
- `confirmQaListPermanentDeletion()` should remove from query data optimistically and invalidate on settle.
- `submitQaListCreation()` and `importQaListFromTmx()` should add the new QA list through query mutation success/optimistic data, then persist cache from query data.
- Editor-term operations can remain direct editor-state operations initially, but after saving a term they should update the list query summary through `patchQaListQueryData()` or invalidation, not by directly assigning `state.qaLists`.

Default QA list behavior:

- Keep `qa-list-default-cache.js` initially if that is still the source of truth for default IDs.
- Move `makeQaListDefault()` into a mutation-style helper or a small query-adjacent action that updates default storage and then invalidates/projects the current QA list query.
- Ensure `makeQaListDefaultIfFirst()` runs only after the new/restored QA list is present in the query snapshot.
- Tests must verify that making one QA list default only affects active lists with the same `language.code`.

### 5. Normalize Persistent Cache Behavior

For Projects, Glossaries, and QA Lists:

- Read persistent cache only when the cache key matches the selected team.
- Write persistent cache from confirmed query snapshots.
- Do not write persistent cache from ad hoc direct state updates.
- Do not let cached data from one team seed another team’s page.

Implementation detail:

- Projects already use team-scoped project cache keys. Keep that pattern.
- Glossaries already use `teamCacheKey(team)` in query seeding. Preserve that check.
- QA Lists already use `teamCacheKey(team)` in `qa-list-cache.js`; move usage into `seedQaListsQueryFromCache()`.
- Avoid calling `saveStored*ForTeam(team, state.*)` from mutation functions before the query cache has been patched and projected.
- Prefer small helpers that persist from query data, for example `persistGlossariesQueryDataForTeam(team, queryData)` and `persistQaListsQueryDataForTeam(team, queryData)`, so cache writes do not depend on whatever happens to be visible in global state.

### 6. Normalize Refresh Behavior

For Projects, Glossaries, and QA Lists:

- Local disk refresh returns a snapshot.
- Remote refresh returns a snapshot.
- Snapshots are merged into query data.
- Query data is then projected into app state.
- Refresh functions should not directly assign rendered page state.

Implementation detail:

- `loadTeamGlossaries()` should not call `applyGlossariesQuerySnapshotToState()` after `fetchQuery()` if an observer is active. The observer should project the fetched query result.
- If a loader must project manually for an inactive page, it must use the same `apply*QuerySnapshotToState()` helper and only after writing the snapshot to `queryClient`.
- `seedGlossariesQueryFromLocal()` and the new `seedQaListsQueryFromCache()` may project immediately because they are fast initial query seeds, but they must still write `queryClient.setQueryData()` first.
- Any recovery callback like `onRecoveryDetected` may set transient discovery/loading text, but it must not replace the resource list.
- Before every top-level lifecycle mutation, call `queryClient.cancelQueries({ queryKey })`.

### 7. Tests

Add regression tests for the stale-refresh race.

Glossaries:

- soft-delete remains deleted if a stale local snapshot arrives after the mutation starts
- soft-delete remains deleted if a stale remote snapshot arrives after the mutation starts
- restore remains restored after stale refresh
- rename remains renamed after stale refresh
- make default remains stable after stale refresh

Projects:

- production soft-delete path uses the mutation helper
- production rename path uses the mutation helper
- production restore path uses the mutation helper
- stale refresh cannot undo those actions

QA Lists:

- soft-delete remains deleted after stale refresh
- restore remains restored after stale refresh
- rename remains renamed after stale refresh
- make default only changes QA lists for the same language
- stale refresh cannot undo the per-language default state

Team switching:

- cached Projects data only appears for the selected team
- cached Glossaries data only appears for the selected team
- cached QA Lists data only appears for the selected team
- stale refresh from a previous team cannot overwrite the current team’s page

Implementation detail:

Add or update these test files:

- `src-ui/app/glossary-query.test.js`
- `src-ui/app/glossary-lifecycle-flow.test.js` if lifecycle action-level tests do not already exist
- `src-ui/app/project-query.test.js`
- `src-ui/app/project-flow.test.js` for production action wiring
- `src-ui/app/qa-list-query.test.js`
- `src-ui/app/qa-list-flow.test.js`
- `src-ui/app/qa-list-default-flow.test.js`

The stale-refresh tests should exercise the actual merge helper directly and at least one production action path:

1. Seed query data with an active item.
2. Start a soft-delete mutation and assert the item moves to deleted with `pendingMutation`.
3. Simulate stale refresh data that still contains the active item.
4. Merge/project the stale refresh.
5. Assert the item is still deleted.
6. Simulate mutation success and assert `pendingMutation` clears but `localLifecycleIntent` remains.
7. Simulate one more stale refresh and assert the item is still deleted.

Add equivalent tests for restore and rename.

## Acceptance Criteria

- Soft-deleting a glossary never renders it as active again during cache, local, or remote refresh.
- QA list soft-delete has the same stable behavior.
- Project soft-delete, restore, and rename use the query mutation path in production.
- Top-level page lifecycle actions do not patch rendered state outside TanStack mutation handlers.
- Cache/local/remote refreshes update rendered state only through query snapshots.
- Team-scoped cache keys prevent cross-team stale page content.
- Tests cover the stale refresh regression for Glossaries, Projects, and QA Lists.

## Suggested Rollout Order

1. Fix Glossaries, because that is the currently reproduced bug.
2. Wire Projects production lifecycle actions to the existing mutation helpers.
3. Add the QA Lists query layer before more QA List features depend on the current direct state flow.
4. Normalize persistent cache and refresh code across all three top-level list pages.
