# Project Loading Consolidation Plan

## Background

The Projects page currently has two project-loading implementations that both participate in one load path:

- `src-ui/app/project-flow.js::loadTeamProjects` primes the Projects screen, sets refresh state, attaches the query observer, fetches the query, persists data, and clears refresh state.
- `src-ui/app/project-query.js::createProjectsQueryOptions` defines the query and calls into `project-discovery-flow.js`.
- `src-ui/app/project-discovery-flow.js::loadRepoBackedProjectsForTeam` calls another `loadTeamProjects`, which also mutates global project state, sets discovery state, renders, and manages page sync.

This splits ownership of visible project state, discovery state, refresh state, repo sync state, query cache, and rendering across multiple layers. It makes stuck-refresh bugs harder to reason about and can disable actions like **Add files** even when the permissions matrix allows the user to manage projects.

## Goals

- Keep one clear public Projects loading entry point.
- Make lower-level project discovery return data instead of owning UI state.
- Make query/cache code the only boundary that maps loaded data into query snapshots.
- Make UI/controller code the only boundary that starts screen-level loading flows and represents user intent.
- Prevent background list refreshes from disabling **Add files** for owners/admins.

## Ownership Rules

- `project-flow.js` owns user intent and screen flow. It can start a Projects screen load, prime visible loading state, attach or refresh the query observer, and handle navigation-level cleanup.
- `project-query.js` owns query cache state, observer subscriptions, query fetch state, and applying final query snapshots to visible project state.
- `project-discovery-flow.js` owns lower-level discovery and repo reconciliation. It should return snapshot data and emit explicit progress events, but it should not own final visible project state, query cache state, or page refresh state.
- Progressive UI feedback must flow through explicit callbacks or progress events. Hidden global writes from the lower-level loader should be removed in small steps.

## Plan

1. [Done] Add characterization tests before refactoring.
   - Cached project data appears quickly before remote sync completes.
   - Remote sync updates the cached data.
   - Stale project loads are ignored. Existing coverage remains in `project-query` / loading tests.
   - `state.projectsPage.isRefreshing` clears after success, error, and stale refresh. Existing coverage remains in `project-flow` / query tests.
   - Owner/admin can see and click **Add files** while Projects is refreshing.
   - Clicking **Add files** is not blocked by a background project-list refresh in the action/import path.

2. [Done] Rename the lower-level loader.
   - In `src-ui/app/project-discovery-flow.js`, rename the lower-level `loadTeamProjects` conceptually to something like `loadProjectSnapshotForTeam`.
   - Start with a behavior-preserving wrapper/rename only. Do not remove global mutations in the same step.
   - Its eventual job should be to read local cache/repos, query GitHub/metadata, reconcile repo state, and return a snapshot object.

3. [Done] Define a lower-level loader result contract.
   - Return one normalized object containing:
     - `items`
     - `deletedItems`
     - `repoSyncByProjectId`
     - `glossaries`
     - `pendingChapterMutations`
     - `discovery`
   - Preserve progressive cached rendering by introducing explicit progress events, for example:
     - `localSnapshot`
     - `remoteSyncStarted`
     - `remoteSnapshot`
     - `repoSyncProgress`
     - `repoSyncComplete`
     - `error`
   - The progress callback may update temporary user-visible feedback, but final visible project state should still flow through the query snapshot path.

4. [Done] Move state application out of `project-discovery-flow.js` incrementally.
   - [Done] First, make every direct mutation inside the lower-level loader correspond to either a returned result field or an explicit progress event.
   - [Done] Then remove direct writes to `state.projects` and `state.deletedProjects` from the main project snapshot loader.
   - [Done] Then remove direct ownership of `state.projectDiscovery` and `state.projectRepoSyncByProjectId` from `project-discovery-flow.js`; glossary publication, file-refresh publication, tombstone repo-sync cleanup, project-discovery repo-sync reconciliation, and the fallback state-applying publisher have moved through explicit callbacks.
   - [Done] Finally, remove direct page refresh ownership from the lower-level loader.
   - [Done] Keep long-running repo sync feedback visible through progress callbacks during the transition.

5. [Done] Make `project-query.js` the query/cache boundary.
   - `createProjectsQueryOptions()` should call the lower-level snapshot loader and receive plain data.
   - It should normalize that data into `createProjectsQuerySnapshot(...)`.
   - Query observer code should be the only place that maps query `isFetching` to query-driven `state.projectsPage.isRefreshing`.
   - [Done] `applyProjectsQuerySnapshotToState(...)` is the single path that applies query snapshots to visible project state. Normal query loads now publish intermediate cached/progress snapshots through the query layer; direct discovery tests now provide an explicit publisher instead of relying on discovery fallback state writes.

6. [Done] Make `project-flow.js` the screen/controller boundary.
   - Keep `project-flow.js::loadTeamProjects()` as the public UI entry point.
   - It should prime the screen for a user-requested load, attach or refresh the query observer, call `queryClient.fetchQuery(...)`, and handle navigation-level cleanup.
   - It should not compete with `project-query.js` for query fetch state ownership.
   - [Done] It should not duplicate project discovery or repo reconciliation logic.

7. [Done] Fix **Add files** during refresh.
   - Decouple **Add files** from background project-list refresh.
   - Keep it disabled for offline mode, active import, unavailable local repo, blocked content state, or lack of permission.
   - Do not disable it solely because `state.projectsPage.isRefreshing === true`.
   - Verify both the rendered button state and the action/import flow.

8. [Done] Add post-refactor regression tests.
   - [Done] The lower-level snapshot loader returns data without mutating global UI refresh state.
   - [Done] Direct lower-level loading without a publisher returns data without mutating visible Projects state.
   - [Done] Query snapshot application flows through the query layer, not the discovery loader.
   - [Done] Progress events preserve cached-first rendering and long-running sync feedback.

## Migration Strategy

Do this in small commits:

1. [Done] Add characterization tests for the current load behavior and Add files bug.
2. [Done] Rename/wrap the lower-level loader without behavior changes.
3. [Done] Introduce the lower-level loader result/progress contract while keeping existing behavior.
4. [Done] Move project state application out of `project-discovery-flow.js`.
5. [Done] Move refresh/render ownership fully into `project-flow.js` and `project-query.js`.
6. [Done] Relax the **Add files** disabled logic and verify the action/import path.
7. [Done] Add final regression tests for the consolidated ownership model.

## Current Status

Completed in the first implementation pass:

- **Add files** is no longer disabled solely by `state.projectsPage.isRefreshing === true`.
- The rendered Projects screen and import modal action path are covered by tests.
- `project-query.js` now calls `loadProjectSnapshotForTeam` directly.
- `project-discovery-flow.js` now exposes `loadProjectSnapshotForTeam`, returns a normalized snapshot, and emits progress events.
- Cached-first project loading behavior is preserved and tested.
- Visible project snapshot publication in `project-discovery-flow.js` now goes through `publishProjectLoadSnapshot`.
- Normal query-driven progressive project snapshots are now published by `project-query.js`.
- Project page-sync start/complete/fail behavior is now injected from `project-flow.js` instead of imported directly by `project-discovery-flow.js`.
- Glossary data loaded during project discovery is now published through the project snapshot publisher instead of direct glossary page-state writes.
- Project file refreshes called from chapter/import flows now publish through the query snapshot path instead of relying on the discovery fallback publisher.
- Tombstone cleanup in project discovery now removes repo-sync state through an injected callback.
- The main project discovery loader now keeps pending chapter mutations as an explicit local value and publishes it with snapshots.
- Project repo-sync reconciliation now accepts injected apply/merge handlers, and project discovery uses them to publish repo-sync snapshots through `publishProjectLoadSnapshot`.
- Direct lower-level snapshot loading is covered by a regression test proving it does not mutate Projects page-sync state without an injected controller.

Completed follow-up cleanup:

- [Done] Remove the fallback state-applying publisher from `project-discovery-flow.js` after all direct callers provide publishers.
- [Done] Move discovery state and repo-sync state publication out of `project-discovery-flow.js` entirely.
- [Done] Remove the remaining transitional repo-sync fallback reads in the query publisher; it now carries forward the last query snapshot instead of reading global state as a fallback.
- [Done] Remove the remaining discovery progress fallback snapshot reads; the lower loader now carries forward its own current load result for progress callbacks and early returns.
- Page-sync ownership has moved to the screen/query layer. Discovery still accepts `render` only as part of injected progress callbacks for progressive UI updates.
- [Done] Remove compatibility exports once all call sites and tests use the new names.
- [Done] Add final tests proving the lower-level loader no longer mutates global UI state directly.

## Target Architecture

- `project-flow.js`: screen/controller entry point.
- `project-query.js`: query cache, query observer, and query snapshot application boundary.
- `project-discovery-flow.js`: lower-level project snapshot loading and repo discovery logic.

The end state should be: one loader returns data, one query layer owns cache/fetch state, and one screen controller owns UI flow.
