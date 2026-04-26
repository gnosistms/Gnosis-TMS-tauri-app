# Projects TanStack Query Implementation Plan

## Purpose

This is the concrete implementation plan for migrating the Projects page to TanStack Query. It is based on `PROJECTS_TANSTACK_QUERY_PLAN.md`, but this file is intentionally more procedural.

Each stage should be small enough to test and revert independently.

## Hard Boundaries

Do not migrate these in this implementation pass:

- project create/import
- add files
- permanent project delete
- repair/rebuild project repo
- overwrite conflicted project repos
- chapter/file rename/delete/restore/permanent delete
- chapter glossary link changes
- project search internals

Only migrate:

- project list refresh orchestration
- top-level project rename
- top-level project soft delete
- top-level project restore

## Stage 0: Inventory And Guardrails

Goal:
Confirm the current flow and protect the parts that should not move.

Read these files before editing:

- `src-ui/app/project-flow.js`
- `src-ui/app/project-discovery-flow.js`
- `src-ui/app/project-top-level-state.js`
- `src-ui/app/project-chapter-flow.js`
- `src-ui/screens/projects.js`
- `src-ui/app/query-client.js`
- `src-ui/app/resource-page-controller.js`
- `src-ui/app/team-metadata-flow.js`

Current functions to preserve:

- `commitProjectMutationStrict(...)`
- `projectMetadataRecordFromVisibleProject(...)`
- `completeProjectCreateSynchronously(...)`
- `refreshProjectFilesFromDisk(...)`
- `reconcileProjectRepoSyncStates(...)`
- `loadStoredProjectsForTeam(...)`
- `loadStoredChapterPendingMutations(...)`
- `applyPendingMutations(...)`
- `applyProjectSnapshotToState(...)`

State fields involved:

- `state.projects`
- `state.deletedProjects`
- `state.projectDiscovery`
- `state.projectRepoSyncByProjectId`
- `state.projectsPage`
- `state.projectsPageSync`
- `state.pendingChapterMutations`
- `state.glossaries`
- `state.expandedProjects`
- `state.expandedDeletedFiles`
- `state.projectSyncVersion`
- `state.projectDiscoveryRequestId`

Do not change behavior in this stage.

Verification:

- No code changes required.

Rollback boundary:

- None.

## Stage 1: Query Key And Snapshot Adapter

Goal:
Add the Projects query skeleton with no behavior change.

Files to edit:

- `src-ui/app/query-client.js`
- `src-ui/app/project-query.js` new
- `src-ui/app/project-query.test.js` new

Implement in `query-client.js`:

```js
export const projectKeys = {
  all: ["projects"],
  byTeam: (teamId) => ["projects", teamId],
};
```

Implement in `project-query.js`:

```js
export function createProjectsQuerySnapshot({
  items = [],
  deletedItems = [],
  repoSyncByProjectId = {},
  glossaries = [],
  pendingChapterMutations = [],
  discovery = {},
} = {}) { ... }
```

Snapshot shape:

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

Implement:

```js
export function applyProjectsQuerySnapshotToState(snapshot, {
  teamId = state.selectedTeamId,
  isFetching = false,
  reconcileExpandedDeletedFiles,
} = {}) { ... }
```

Rules:

- If `state.selectedTeamId !== teamId`, return `false` and do nothing.
- Use `applyProjectSnapshotToState(snapshot.snapshot, { reconcileExpandedDeletedFiles })`.
- Set `state.projectRepoSyncByProjectId`.
- Set `state.glossaries`.
- Set `state.pendingChapterMutations`.
- Set `state.projectDiscovery`.
- Set `state.projectsPage.isRefreshing = isFetching === true`.
- Return `true` if applied.

Tests:

- Adapter maps active and deleted projects into state.
- Adapter maps repo sync, glossaries, pending chapter mutations, and discovery.
- Adapter ignores stale selected-team snapshots.

Verification:

- `node --check src-ui/app/project-query.js`
- `node --test --loader ./src-ui/test/raw-loader.mjs src-ui/app/project-query.test.js`

Rollback boundary:

- Delete `project-query.js`, `project-query.test.js`, and remove `projectKeys`.

## Stage 2: Cached Seed

Goal:
Seed the Projects query from existing local cache before any repo-backed refresh.

Files to edit:

- `src-ui/app/project-query.js`
- `src-ui/app/project-query.test.js`

Implement:

```js
export async function seedProjectsQueryFromCache(team, {
  teamId = team?.id,
  loadStoredProjectsForTeam,
  loadStoredChapterPendingMutations,
  applyChapterPendingMutation,
  reconcileExpandedDeletedFiles,
  render,
} = {}) { ... }
```

Behavior:

- Load cached projects with `loadStoredProjectsForTeam(team)`.
- Load pending chapter mutations with `loadStoredChapterPendingMutations(team)`.
- Apply pending chapter mutations using `applyPendingMutations(...)`.
- If no cached projects exist, return `null`.
- Create a query snapshot with cached active/deleted projects.
- Store it with `queryClient.setQueryData(projectKeys.byTeam(teamId), snapshot)`.
- Apply it to global state using the adapter.
- Render after applying.

Important:

- This stage should not call GitHub, metadata list, repo sync, or local file listing.
- This stage should preserve current cached-first behavior only.

Tests:

- Seed applies cached projects and deleted projects.
- Seed overlays pending chapter mutations.
- Seed no-ops for stale selected team.
- Seed returns `null` when cache does not exist.

Verification:

- Focused project query tests.

Rollback boundary:

- Remove `seedProjectsQueryFromCache`.

## Stage 3: Extract Repo-Backed Loader

Goal:
Create a loader that returns a project query snapshot while preserving current discovery semantics.

Files to edit:

- `src-ui/app/project-discovery-flow.js`
- `src-ui/app/project-query.js`
- `src-ui/app/project-query.test.js`

Add to `project-discovery-flow.js`:

```js
export async function loadRepoBackedProjectsForTeam(selectedTeam, options = {}) { ... }
```

This function should be extracted from the current `loadTeamProjects(...)` body. It should return:

```js
{
  items,
  deletedItems,
  repoSyncByProjectId,
  glossaries,
  pendingChapterMutations,
  discovery
}
```

Rules:

- Keep the existing metadata, remote project, repair, tombstone, local file listing, repo sync, and glossary warning behavior.
- Keep `reconcileProjectRepoSyncStates(...)` and `refreshProjectFilesFromDisk(...)` behavior, but return the final state as data.
- Keep stale guards using selected team, request id, and `projectSyncVersion`.
- Any progress/recovery callback must include a team guard before touching global state.
- Do not remove the existing `loadTeamProjects(...)` yet.

Pragmatic extraction approach:

1. Keep most helper functions in `project-discovery-flow.js`.
2. Move the data-producing part into `loadRepoBackedProjectsForTeam`.
3. Let existing `loadTeamProjects(...)` call the new function and then apply the returned snapshot.
4. Confirm behavior is unchanged before adding Query.

Tests:

- Add minimal unit coverage only where practical.
- Existing project screen/discovery tests should continue passing.

Verification:

- Focused existing project tests if available.
- Full `npm test` after this stage.

Rollback boundary:

- Restore `loadTeamProjects(...)` to its previous direct body.

## Stage 4: Query-Backed Load Wrapper

Goal:
Make Projects page refresh query-backed while preserving cached-first behavior.

Files to edit:

- `src-ui/app/project-query.js`
- `src-ui/app/project-flow.js`
- `src-ui/app/project-discovery-flow.js`
- `src-ui/app/project-query.test.js`

Implement in `project-query.js`:

```js
export function createProjectsQueryOptions(team, options = {}) { ... }
export function ensureProjectsQueryObserver(render, team, options = {}) { ... }
export async function invalidateProjectsQueryAfterMutation(team, options = {}) { ... }
```

`createProjectsQueryOptions` should call `loadRepoBackedProjectsForTeam(team, options)` and wrap the result with `createProjectsQuerySnapshot(...)`.

`ensureProjectsQueryObserver` should:

- subscribe with `subscribeQueryObserver(...)`
- apply results through `applyProjectsQuerySnapshotToState(...)`
- guard stale team results
- call `render`

`invalidateProjectsQueryAfterMutation` should mirror Glossaries:

- `invalidateQueries({ queryKey, refetchType: hasActiveObserver ? "active" : "none" })`
- only call `fetchQuery` if there is no active observer

Refactor `project-flow.js` `loadTeamProjects(...)`:

- keep `refreshProjectSearchIndex(render, teamId)`
- set selected team
- seed query from cache
- ensure observer
- fetch query
- apply final snapshot
- persist projects cache
- render

Preserve:

- offline cached behavior
- glossary warning behavior
- recovery message behavior
- project sync badge behavior
- stale-team and project sync version guards

Tests:

- Query options produce expected snapshot from mocked loader.
- Observer apply ignores stale team.
- Invalidation does not double-fetch with active observer.

Verification:

- Focused query tests.
- `npm test`
- `npm run build`

Rollback boundary:

- Restore `project-flow.js loadTeamProjects` to direct `runLoadTeamProjects`.
- Keep adapter code if harmless, or delete it.

## Stage 5: Rename Mutation

Goal:
Make top-level project rename query-backed and optimistic.

Files to edit:

- `src-ui/app/project-query.js`
- `src-ui/app/project-flow.js`
- `src-ui/app/project-query.test.js`

Implement:

```js
export function patchProjectQueryData(queryData, projectId, patch) { ... }
export function createProjectRenameMutationOptions(options = {}) { ... }
export async function runProjectRenameMutation(options = {}) { ... }
```

Mutation options:

- `mutationKey: ["project", "rename", project.id]`
- `scope: { id: `team-metadata:${team.installationId}` }`
- `mutationFn` calls `commitProjectMutationStrict(team, mutation)`
- `onMutate` cancels project query, snapshots previous data, patches title, sets `pendingMutation: "rename"`, applies to state, closes rename modal
- `onError` restores previous query data and applies it to state
- `onSuccess` clears `pendingMutation`
- `onSettled` invalidates project query

Refactor `submitProjectRename(...)`:

- Use `runProjectRenameMutation`.
- Do not use `submitResourcePageWrite` for rename.
- Block only when `state.projectsPage.writeState !== "idle"`.
- Allow rename while `state.projectsPage.isRefreshing === true`.
- If refresh was already active, do not complete/fail the visible project sync badge for the refresh.

Tests:

- Rename optimistic patch updates query cache and state immediately.
- Rename closes modal on optimistic apply.
- Rename failure rolls back cache and state.
- Rename mutation uses team metadata scope.
- Rename remains enabled during refresh but disabled during another write.

Verification:

- Focused project query tests.
- Focused projects screen tests.

Rollback boundary:

- Restore `submitProjectRename` to `submitResourcePageWrite`.
- Remove rename mutation helpers.

## Stage 6: Preserve Pending Refresh Patches

Goal:
Prevent refresh snapshots from overwriting in-flight optimistic top-level project lifecycle mutations.

Files to edit:

- `src-ui/app/project-query.js`
- `src-ui/app/project-query.test.js`

Implement:

```js
export function preservePendingProjectLifecyclePatches(nextSnapshot, previousSnapshot) { ... }
```

Rules:

- Pending rename keeps local `title`.
- Pending soft delete keeps project in `deletedItems`.
- Pending restore keeps project in `items`.
- Preserve `pendingMutation`.
- Do not alter chapter/file data beyond moving the owning project between top-level collections.

Call this from `createProjectsQueryOptions` before returning fetched snapshot:

```js
return preservePendingProjectLifecyclePatches(
  nextSnapshot,
  queryClient.getQueryData(projectKeys.byTeam(teamId)),
);
```

Tests:

- Refresh snapshot preserves pending rename title.
- Refresh snapshot preserves pending soft delete collection placement.
- Refresh snapshot preserves pending restore collection placement.

Verification:

- Focused project query tests.

Rollback boundary:

- Remove helper and call site.

## Stage 7: Soft Delete And Restore Mutations

Goal:
Make top-level project soft delete and restore query-backed and optimistic.

Files to edit:

- `src-ui/app/project-query.js`
- `src-ui/app/project-flow.js`
- `src-ui/app/project-query.test.js`

Implement:

```js
export function createProjectSoftDeleteMutationOptions(options = {}) { ... }
export function createProjectRestoreMutationOptions(options = {}) { ... }
export async function runProjectSoftDeleteMutation(options = {}) { ... }
export async function runProjectRestoreMutation(options = {}) { ... }
```

Soft delete optimistic behavior:

- remove from `snapshot.items`
- add to `snapshot.deletedItems`
- set lifecycle state to deleted convention used by current Projects state
- set `pendingMutation: "softDelete"`

Restore optimistic behavior:

- remove from `snapshot.deletedItems`
- add to `snapshot.items`
- set `lifecycleState: "active"`
- set `pendingMutation: "restore"`

Refactor:

- `deleteProject(...)`
- `restoreProject(...)`

Rules:

- Do not use `submitResourcePageWrite` for top-level soft delete/restore.
- Block only on `writeState !== "idle"`.
- Allow during refresh.
- Keep permission, tombstone, and offline guards unchanged.
- Keep permanent delete pessimistic.

Tests:

- Soft delete moves active project to deleted collection.
- Soft delete failure rolls back.
- Restore moves deleted project to active collection.
- Restore failure rolls back.
- Mutations use team metadata scope.

Verification:

- Focused tests.
- `npm test`.

Rollback boundary:

- Restore `deleteProject` and `restoreProject` to `submitResourcePageWrite`.
- Remove mutation helpers.

## Stage 8: Refresh-Time Button Policy

Goal:
Match runtime behavior in the Projects screen.

Files to edit:

- `src-ui/screens/projects.js`
- `src-ui/screens/projects.test.js` new or existing
- possibly `src-ui/app/project-flow.js` for runtime guards on repair/rebuild

Implement screen split:

- `lifecycleActionsDisabled = areResourcePageWriteSubmissionsDisabled(state.projectsPage)`
- `pageWritesDisabled = areResourcePageWritesDisabled(state.projectsPage)`

Use `lifecycleActionsDisabled` for:

- top-level project Rename
- top-level project Delete
- deleted project Restore

Use `pageWritesDisabled` for:

- New Project
- Add files
- permanent project delete
- repair/rebuild resolution actions
- chapter/file actions
- glossary selector changes

Keep overwrite conflicted repos blocked by:

- offline mode
- `state.projectsPageSync.status === "syncing"`
- any other existing conflict recovery guard

Tests:

- During refresh:
  - expand/open/show-deleted controls remain enabled
  - top-level rename/delete/restore remain enabled
  - New Project/Add files/permanent delete/chapter actions/repair/rebuild are disabled
- During write submission:
  - top-level rename/delete/restore are disabled

Verification:

- Focused projects screen tests.

Rollback boundary:

- Revert `projects.js` guard split.

## Stage 9: Cleanup And Full Verification

Goal:
Remove accidental duplication and prove the migration is stable.

Cleanup:

- Remove dead imports created by migration.
- Keep compatibility wrappers only if still used.
- Do not refactor unrelated project/chapter logic.
- Do not extract generic lifecycle helpers yet unless duplication is clearly harmful.

Run:

- `node --check` on changed files.
- Focused query tests.
- Focused screen tests.
- `npm test`.
- `npm run build`.

Manual app checks:

- Open Projects page with cached data.
- Refresh Projects page.
- Switch teams during refresh.
- Rename a project during refresh.
- Soft delete a project during refresh.
- Restore a project during refresh.
- Confirm New Project/Add files/permanent delete remain blocked during refresh.
- Confirm chapter/file actions remain conservative.
- Confirm project search still works.
- Confirm deleted project and deleted file sections still behave correctly.

Completion definition:

- Projects list refresh is query-backed.
- Cached-first behavior is preserved.
- Top-level rename/delete/restore are optimistic and query-backed.
- Refresh snapshots preserve pending top-level lifecycle patches.
- Heavy repo/content/chapter operations remain conservative.
- Full tests and build pass.

