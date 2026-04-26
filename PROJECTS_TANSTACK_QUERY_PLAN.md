# TanStack Query Projects Page Plan

## Goal

Apply the lessons from the Glossaries TanStack Query migration to the Projects page without changing project repo, chapter, search, metadata, tombstone, or repair semantics.

This should be an orchestration refactor. TanStack Query should own project-list loading, refresh state, invalidation, stale-result guarding, and small reversible optimistic top-level lifecycle updates. Existing project repo sync, local file listing, chapter pending mutation, repair, tombstone, and conflict logic should stay in the current project flows.

## Lessons From Glossaries

Carry these forward:

- Keep the app framework-agnostic. Use `@tanstack/query-core`, not React bindings.
- Keep screens reading global state during the first migration. Add a query-to-state bridge instead of rewriting the screen.
- Guard every query apply path with `teamId`; stale observer notifications, recovery callbacks, mutation rollback, and refresh completion must no-op after team changes.
- Preserve local-first behavior. Seed visible state from local/cache data before repo-backed refresh.
- Use the central team metadata write queue for all metadata record writes.
- Use TanStack mutation `scope` for query-backed lifecycle mutations.
- Avoid double refreshes after mutation success. Invalidate on settle; only force a fetch if there is no active observer.
- Preserve pending optimistic patches when a refresh snapshot arrives mid-mutation.
- Split refresh blocking from write blocking:
  - read-only/navigation actions can stay enabled during refresh
  - query-backed lifecycle actions can stay enabled during refresh when no other write is running
  - heavier repo/content operations stay blocked during refresh

## Current Projects-Specific Shape

The Projects page is more coupled than Glossaries. The first migration must respect these extra responsibilities:

- `state.projects` and `state.deletedProjects` are separate collections.
- `state.projectDiscovery` carries load/error/glossary warning/recovery state.
- `state.projectRepoSyncByProjectId` carries repo sync and repair status.
- `state.projectsPage` controls resource-page write/refresh state.
- `state.projectsPageSync` controls the visible Projects page sync badge.
- `state.pendingChapterMutations` overlays optimistic chapter/file mutations onto project snapshots.
- Projects discovery also loads available glossaries for chapter glossary selectors.
- Projects discovery refreshes the project search index.
- Project cards include top-level project lifecycle actions and nested file/chapter actions.

Therefore, the first TanStack Query pass should migrate only the top-level Projects list and top-level project lifecycle actions:

- project list refresh
- project rename
- project soft delete
- project restore

Do not migrate these in the first pass:

- project create/import
- permanent project delete
- repair/rebuild/overwrite conflicted repos
- chapter/file rename, delete, restore, permanent delete
- chapter glossary link changes
- project search internals

## Query Infrastructure

Reuse the existing query infrastructure added for Glossaries:

- `src-ui/app/query-client.js`
- `queryClient`
- `createMutationObserver`
- `subscribeQueryObserver`

Add project query key helpers:

```js
projectKeys = {
  all: ["projects"],
  byTeam: (teamId) => ["projects", teamId],
}
```

Keep this plain JavaScript and independent of React.

## Project Query Shape

Use one page-level query:

```js
["projects", teamId]
```

Suggested query result shape:

```js
{
  snapshot: {
    items,
    deletedItems
  },
  repoSyncByProjectId,
  glossaries,
  pendingChapterMutations,
  discovery: {
    status,
    error,
    glossaryWarning,
    recoveryMessage
  }
}
```

Notes:

- `snapshot.items` maps to `state.projects`.
- `snapshot.deletedItems` maps to `state.deletedProjects`.
- `repoSyncByProjectId` maps to `state.projectRepoSyncByProjectId`.
- `glossaries` maps to `state.glossaries` for chapter glossary selectors.
- `pendingChapterMutations` should continue to be loaded/applied through the existing project cache and optimistic collection helpers.

The query function should reuse existing logic from:

- `src-ui/app/project-discovery-flow.js`
- `loadStoredProjectsForTeam(...)`
- `loadStoredChapterPendingMutations(...)`
- `applyPendingMutations(...)`
- `listProjectMetadataRecords(...)`
- `inspectAndMigrateLocalRepoBindings(...)`
- `repairAutoRepairableRepoBindings(...)`
- `reconcileProjectRepoSyncStates(...)`
- `refreshProjectFilesFromDisk(...)`
- `loadRepoBackedGlossariesForTeam(...)`

Do not move GitHub/local repo conflict semantics into Query. Query should orchestrate the existing flow.

## Refactor Boundary

Create a new adapter module, likely:

```text
src-ui/app/project-query.js
```

It should own:

- `createProjectsQuerySnapshot(...)`
- `applyProjectsQuerySnapshotToState(snapshot, { teamId, isFetching })`
- `seedProjectsQueryFromCache(team, options)`
- `createProjectsQueryOptions(team, options)`
- `ensureProjectsQueryObserver(render, team, options)`
- `invalidateProjectsQueryAfterMutation(team, options)`
- top-level lifecycle mutation helpers

Keep `src-ui/screens/projects.js` mostly unchanged in the first pass.

## Loading Flow

Refactor `loadTeamProjects` in `src-ui/app/project-flow.js` into a thin query wrapper.

Desired flow:

1. Set `state.selectedTeamId`.
2. Start project search index refresh as today:
   - `void refreshProjectSearchIndex(render, teamId).catch(() => {})`
3. Seed visible state from cached projects:
   - `loadStoredProjectsForTeam(selectedTeam)`
   - `loadStoredChapterPendingMutations(selectedTeam)`
   - apply pending chapter mutations to cached snapshot
   - apply to state before repo refresh
4. Ensure a project query observer exists for `["projects", teamId]`.
5. Fetch the query.
6. Apply query snapshot only if:
   - selected team is still the same
   - project sync version/request identity is still current
7. Persist project cache after successful query-backed refresh.
8. Keep existing recovery/error UI.

Preserve these current behaviors:

- cached projects appear before remote refresh finishes
- offline mode uses cached projects
- pending chapter mutations are applied to visible data
- available glossaries still load for chapter glossary selectors
- repo sync and local file refresh still run before the final ready snapshot
- project search index refresh still runs when the Projects page loads

## State Bridge

Add:

```js
applyProjectsQuerySnapshotToState(snapshot, {
  teamId,
  isFetching,
  reconcileExpandedDeletedFiles,
})
```

It should update:

- `state.projects`
- `state.deletedProjects`
- `state.projectRepoSyncByProjectId`
- `state.glossaries`
- `state.pendingChapterMutations`
- `state.projectDiscovery`
- `state.projectsPage.isRefreshing`

It must no-op if `state.selectedTeamId !== teamId`.

It should use existing helpers:

- `applyProjectSnapshotToState(...)`
- `reconcileExpandedDeletedFiles(...)`

Be careful with deleted-project UI:

- `applyProjectSnapshotToState` currently closes the deleted section if there are no deleted items.
- Preserve that behavior.

## Query Function Extraction

The current `project-discovery-flow.js` does a lot inside `loadTeamProjects`. Do not rewrite it all at once.

Preferred migration path:

1. Extract a pure-ish loader from `project-discovery-flow.js`, for example:

```js
loadRepoBackedProjectsForTeam(selectedTeam, options)
```

2. Have it return a project query snapshot instead of directly applying state at every point.
3. Keep state updates that are intentionally progressive, such as recovery/progress callbacks, behind explicit callbacks that include `teamId` stale guards.
4. Keep `loadTeamProjects` as a compatibility wrapper until the query version is stable.

Important: project discovery currently applies intermediate snapshots before repo sync and file refresh. Preserve user-visible cached/local-first behavior by seeding the query first, then applying final query data when repo-backed loading completes.

## Top-Level Mutations

Create scoped mutation helpers for:

- rename project
- soft delete project
- restore project

Use mutation scope:

```js
scope: { id: `team-metadata:${team.installationId}` }
```

Each mutation should still call the existing backend-facing code:

- `commitProjectMutationStrict(...)`
- `upsertProjectMetadataRecord(...)`
- existing project repo commands already used by `commitProjectMutationStrict`

## Optimistic Project Patches

Only patch reversible top-level fields:

- Rename:
  - patch `title`
  - set `pendingMutation: "rename"`
- Soft delete:
  - move project from `snapshot.items` to `snapshot.deletedItems`
  - set `lifecycleState: "deleted"` or preserve the local deleted convention already used by state
  - set `pendingMutation: "softDelete"`
- Restore:
  - move project from `snapshot.deletedItems` to `snapshot.items`
  - set `lifecycleState: "active"`
  - set `pendingMutation: "restore"`

Do not optimistically patch:

- project create/import
- permanent delete
- repair/rebuild/overwrite conflict recovery
- chapter/file rows
- chapter glossary links
- repo IDs, node IDs, full names, branch names, repo names
- local file listings
- project search index state

Mutation lifecycle:

```js
onMutate:
  cancel project query
  snapshot previous query data
  apply optimistic patch
  apply query snapshot to global state
  close rename modal immediately for rename
  render

onError:
  restore previous query data
  apply restored snapshot to global state
  show error/notice

onSuccess:
  clear pendingMutation from the affected project

onSettled:
  invalidate project query
```

## Preserve Pending Patches During Refresh

Add a helper similar to Glossaries:

```js
preservePendingProjectLifecyclePatches(nextSnapshot, previousSnapshot)
```

It should preserve pending top-level lifecycle patches from the current query data when a refresh result arrives mid-mutation:

- pending rename keeps local `title`
- pending soft delete keeps the project in deleted collection
- pending restore keeps the project in active collection
- `pendingMutation` remains until mutation success/error settles

This prevents a query refresh from briefly replacing optimistic UI with an older repo-backed snapshot.

## Refresh-Time Action Policy

Split Projects page actions into three classes.

Keep read-only/navigation actions enabled during project refresh:

- expand/collapse project cards
- open project/file
- show/hide deleted projects
- show/hide deleted files
- project search interactions where they do not mutate repo state

Allow query-backed top-level lifecycle actions during project refresh when `state.projectsPage.writeState === "idle"`:

- rename project
- soft delete project
- restore project

Keep heavier actions disabled during project refresh:

- create project
- import/add files
- repair/rebuild project repo
- overwrite conflicted project repos
- permanent project delete
- chapter/file rename/delete/restore/permanent delete
- chapter glossary link changes

Implementation guidance:

- Keep `areResourcePageWritesDisabled(state.projectsPage)` for heavy metadata/repo/content actions.
- Use `areResourcePageWriteSubmissionsDisabled(state.projectsPage)` for query-backed top-level lifecycle actions.
- Keep `state.projectsPageSync.status === "syncing"` as a blocker for repo conflict overwrite and any operation that directly depends on repo sync stability.
- Keep glossary selector changes conservative for now, because they mutate chapter metadata and are not part of the top-level project query migration.

## Conflict Policy

TanStack Query handles cache, rollback, and invalidation. Existing project flows still own conflict semantics.

Rules:

- If backend write succeeds, optimistic project state becomes real after invalidation/refetch.
- If backend reports metadata conflict or push conflict, rollback and refetch.
- If remote tombstone/permanent delete is detected, tombstone wins.
- If repo identity differs, block retry through existing repair/rebuild state.
- If refresh detects missing local repo or conflicted repo while a mutation is pending, preserve the optimistic top-level patch but keep the repair/conflict state visible.
- Do not let optimistic project lifecycle updates overwrite pending chapter mutations.

## Rollout Order

Do this incrementally:

1. Add project query key helpers and `project-query.js` adapter with no behavior change.
2. Add query snapshot creation/apply tests.
3. Seed project query from cached projects and apply stale-team guards.
4. Move `loadTeamProjects` to query-backed refresh while preserving current cached-first behavior.
5. Add rename mutation only.
6. Add soft delete mutation.
7. Add restore mutation.
8. Split refresh-time action policy for top-level lifecycle actions.
9. Keep create/import/repair/permanent delete/chapter actions on the current pessimistic path.

## Tests

Add focused tests for:

- Project query adapter maps snapshot into `state.projects` and `state.deletedProjects`.
- Adapter maps `repoSyncByProjectId`, `glossaries`, `pendingChapterMutations`, and discovery state.
- Adapter ignores stale selected-team snapshots.
- Cached project seed applies before repo-backed refresh.
- Offline mode preserves cached projects and glossary warning behavior.
- Pending chapter mutations are preserved when applying query data.
- Rename optimistic patch updates query cache and state immediately.
- Rename failure rolls back query cache and state.
- Soft delete optimistic patch moves a project to deleted collection.
- Restore optimistic patch moves a project to active collection.
- Mutation settle invalidates active project query once without double fetch.
- Project lifecycle mutations use `scope: { id: "team-metadata:<installationId>" }`.
- Refresh snapshots preserve pending optimistic project lifecycle patches.
- During refresh:
  - expand/open/show-deleted remain enabled
  - rename/delete/restore remain enabled if no write is running
  - create/import/add-files/repair/rebuild/overwrite/permanent-delete/chapter writes remain disabled
- Permanent delete remains non-optimistic.

## Verification Checklist

After each milestone:

- Projects page opens with cached/local data before remote refresh finishes.
- Switching teams during refresh does not apply stale project data.
- Project search still works and does not receive stale project identity.
- Pending file/chapter mutations still render correctly.
- Local file counts refresh correctly after repo sync.
- Deleted project and deleted file sections keep their existing behavior.
- Repair/rebuild/conflict recovery states still appear.
- Rename modal closes immediately on optimistic rename.
- Full `npm test` passes.
- `npm run build` passes.

## Non-Goals

- Rewriting project repo sync.
- Rewriting project search.
- Migrating chapter/file lifecycle mutations.
- Optimistic project create/import.
- Optimistic permanent delete.
- Allowing repair/rebuild/overwrite during refresh.
- Changing storage format or metadata schema.

