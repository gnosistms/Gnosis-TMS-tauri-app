# Teams Page Modernization Plan

This plan updates the Teams page to match the query-backed, optimistic, scoped-status pattern used by the modernized members/projects/glossaries flows.

## Goals

- Keep cached teams visible immediately on startup and refresh.
- Make background team refresh non-blocking for ordinary navigation and safe row actions.
- Preserve optimistic rename, soft-delete, restore, and leave behavior.
- Replace ad hoc pending team mutation handling with explicit write intents.
- Keep selected-team state stable during stale refreshes and background confirmations.
- Use scoped Teams status badges instead of temporary debug copy.
- Make cache and query state resistant to interrupted delete/restore/rename operations.

## Current Flow

The Teams page renders from `state.teams`, `state.deletedTeams`, `state.showDeletedTeams`, and `state.orgDiscovery`.

`loadUserTeams(render)` currently:

- Reads stored team records and stored pending mutations.
- Applies pending mutations to the stored snapshot.
- Renders the optimistic local snapshot immediately.
- Fetches `list_accessible_github_app_installations`.
- Reconciles fetched installations with stored records.
- Persists the reconciled record list.
- Re-applies pending mutations.
- Updates `state.teams`, `state.deletedTeams`, and `state.selectedTeamId`.
- Processes pending team mutations in the background.

Team mutations currently live in `src-ui/app/team-flow/actions.js`:

- `rename` uses a pending mutation and background processing.
- `softDelete` and `restore` optimistically move teams between active/deleted lists, then update the GitHub org description.
- permanent delete and leave are modal-driven commands that block until the backend succeeds.
- status feedback uses `showScopedSyncBadge("teams", ...)`, but several messages are debugging-oriented: `Delete clicked`, `First paint reached`, `Background sync started`, etc.

## Narrow Safe Change Surface

Keep these surfaces intact:

- `state.teams`, `state.deletedTeams`, `state.selectedTeamId`, and `state.orgDiscovery`.
- Existing screen actions and modal names.
- Team cache format in `team-storage.js` unless a migration is clearly needed.
- Existing install/setup flows.

Modernize behind the current public UI API:

- Add query adapter modules.
- Add a team write coordinator.
- Refactor `loadUserTeams` and mutation actions to use those helpers.
- Keep `renderTeamsScreen` mostly unchanged except refresh/status/writing state.

## Stage 1: Query Infrastructure

Update `src-ui/app/query-client.js`:

- Add:

```js
export const teamKeys = {
  all: ["teams"],
  currentUser: (login) => ["teams", login ?? null],
};
```

Create `src-ui/app/team-query.js`.

Exports:

- `createTeamsQuerySnapshot({ items, deletedItems, discovery })`
- `applyTeamsQuerySnapshotToState(snapshot, options)`
- `seedTeamsQueryFromCache(options)`
- `createTeamsQueryOptions(options)`
- `ensureTeamsQueryObserver(render, options)`
- `invalidateTeamsQueryAfterMutation(options)`
- `patchTeamQueryData(queryData, teamId, patch)`
- `moveTeamQueryData(queryData, teamId, targetCollection, patch)`
- `removeTeamFromQueryData(queryData, teamId)`
- `resetTeamsQueryObserver()`

`createTeamsQueryOptions` should own the remote call to `list_accessible_github_app_installations`, organization filtering, reconciliation, persistence, and snapshot creation.

`applyTeamsQuerySnapshotToState` should:

- No-op when the auth/session identity changed since the fetch began.
- Clear confirmed team write intents when refreshed data agrees.
- Overlay active team write intents.
- Set `state.teams`, `state.deletedTeams`, `state.orgDiscovery`, and `state.teamsPage.isRefreshing`.
- Reconcile `state.selectedTeamId` with visible active teams.

## Stage 2: Page State

Update `src-ui/app/state.js`:

- Add `teamsPage: createResourcePageState()`.
- Reset `teamsPage` in `resetSessionState()`.
- Keep `orgDiscovery` for screen compatibility during the transition.

Use `teamsPage` for:

- background refresh state
- refresh-button spinner
- future row/write status decisions

## Stage 3: Query-Backed Loading

Refactor `loadUserTeams(render)`:

- Apply cached teams immediately via `seedTeamsQueryFromCache`.
- Start/update a Teams query observer with `ensureTeamsQueryObserver`.
- Move direct remote fetch logic into `createTeamsQueryOptions`.
- Keep offline and unauthenticated behavior:
  - no session: show cached teams and do not remote sync
  - offline: show cached teams and mark discovery ready
- Keep single-team auto-open behavior after a successful current-user query refresh.
- Keep sync-recovery behavior for auth/lost-access failures.

Important stale protections:

- Capture session login/token identity at query creation.
- If auth identity changes before data returns, do not apply it.
- If current `selectedTeamId` no longer exists after refresh, choose the next active team.

## Stage 4: Team Write Coordinator

Create `src-ui/app/team-write-coordinator.js` using `createWriteIntentCoordinator`.

Exports:

- `teamRenameIntentKey(teamId)`
- `teamLifecycleIntentKey(teamId)`
- `teamLeaveIntentKey(teamId)`
- `teamPermanentDeleteIntentKey(teamId)`
- `teamWriteScope(team)`
- `requestTeamWriteIntent(intent, operations)`
- `getTeamWriteIntent(key)`
- `anyTeamWriteIsActive()`
- `applyTeamWriteIntentsToSnapshot(snapshot)`
- `clearConfirmedTeamWriteIntents(snapshot)`
- `resetTeamWriteCoordinator()`

Overlay behavior:

- Rename intent patches `name` and sets `pendingMutation: "rename"`.
- Soft-delete intent moves the team to `deletedItems`, patches deleted metadata, and sets `pendingMutation: "softDelete"`.
- Restore intent moves the team to `items`, clears deleted metadata, and sets `pendingMutation: "restore"`.
- Leave intent removes the team from visible lists after backend success only, unless a later UX decision chooses optimistic leave.
- Permanent delete removes the deleted team after backend success only.

Coalescing:

- Rename key keeps the latest name.
- Soft-delete and restore for the same team supersede each other.
- Permanent delete supersedes restore/rename for that deleted team.
- Leave should block rename/delete for the same team while running.

## Stage 5: Rename

Refactor `submitTeamRename(render)`:

- Validate current team and new name.
- Close/reset the modal after optimistic apply.
- Request `teamRenameIntentKey(team.id)`.
- `applyOptimistic`:
  - patch query data
  - patch `state.teams`
  - persist sanitized cache
  - show `Renaming team...`
- `run`:
  - call `update_organization_name_for_installation`
- `onSuccess`:
  - invalidate Teams query
  - show `Team renamed.`
- `onError`:
  - restore previous snapshot
  - reopen modal or show notice with error

## Stage 6: Soft Delete And Restore

Refactor `deleteTeam(render, teamId)` and `restoreTeam(render, teamId)`:

- Remove debug statuses such as `Delete clicked` and `First paint reached`.
- Use lifecycle write intents.
- Optimistically move only the affected team between active/deleted lists.
- Persist optimistic cache without transient fields.
- Run `update_organization_description_for_installation`.
- Keep the optimistic lifecycle state overlaid until refreshed data confirms the marker is present/removed.
- On failure, roll back and show a scoped error notice.

Suggested statuses:

- `Deleting team...`
- `Restoring team...`
- `Refreshing teams...`
- `Team deleted.`
- `Team restored.`

## Stage 7: Leave Team

Keep leave conservative at first.

Refactor `confirmTeamLeave(render)`:

- Use a write intent for status/spinner consistency.
- Keep the modal loading until `leave_organization_for_installation` succeeds.
- Remove the team from cache/state after success.
- Invalidate the Teams query after success.
- Preserve validation that the current user can only leave when owner constraints are satisfied.

Do not optimistically remove the current team until we have more UX confidence, because leaving can change auth/access across pages.

## Stage 8: Permanent Delete

Keep permanent delete conservative.

Refactor `confirmTeamPermanentDeletion(render)`:

- Use a write intent for status/spinner consistency.
- Keep confirmation modal loading until `delete_organization_for_installation` and local purge succeed.
- Remove stored team, project cache, and glossary cache after success.
- Invalidate Teams query after success.
- Show `Team permanently deleted.`

Do not optimistically purge local data before backend success.

## Stage 9: Screen Status And Controls

Update `src-ui/screens/teams/index.js` and `src-ui/screens/teams/team-list.js`:

- Use `buildPageRefreshAction(state, state.pageSync, "refresh-page", { backgroundRefreshing: state.teamsPage?.isRefreshing === true || anyTeamWriteIsActive() })`.
- Prefer `getStatusSurfaceItems("teams")` over separate `syncBadgeText`/notice when ready.
- Keep ordinary row navigation enabled during background refresh.
- Disable only the row/action that truly conflicts with an active write:
  - team rename running: disable rename for that team, keep Projects/Glossaries/Members usable
  - soft-delete running: disable delete/leave/rename for that team
  - restore confirmation refresh: keep restored team usable once visible
  - permanent delete running: disable deleted-team actions for that team
  - background refresh only: keep all row actions enabled
- Disable `+ New Team` only for offline mode or while the setup modal is submitting, not for background refresh.

## Stage 10: Cache Sanitation

Update team cache normalization in `team-storage.js`:

- Strip transient UI fields before saving, including:
  - `pendingMutation`
  - `pendingError`
  - `optimisticClientId`
  - any future `local*Intent` fields
- Normalize impossible active/deleted duplicates.
- Preserve pending writes separately through the write coordinator or a compatibility migration.

Add `src-ui/app/team-cache.test.js`.

Coverage:

- transient fields are not persisted
- legacy transient fields are stripped on load
- deleted/active duplicate records normalize deterministically

## Stage 11: Compatibility Migration

The existing app persists `TEAM_PENDING_MUTATIONS_STORAGE_KEY`.

Add a migration strategy:

- On first query/load after this change, read legacy pending mutations.
- Convert them into team write intents or apply them as compatibility overlays.
- After successful confirmation or failure, clear legacy pending mutations.
- Keep `processPendingTeamMutations` as a wrapper temporarily if needed, but route new writes through the coordinator.

This avoids losing in-flight rename/delete/restore work from users who update while pending mutations exist.

## Stage 12: Tests

Add or update:

- `src-ui/app/team-query.test.js`
- `src-ui/app/team-write-coordinator.test.js`
- `src-ui/app/team-cache.test.js`
- `src-ui/app/team-flow.test.js` or split focused tests under `src-ui/app/team-flow/*.test.js`
- `src-ui/screens/teams.test.js`

Coverage targets:

- cached teams render before remote refresh
- remote refresh updates cached teams
- stale auth/team refresh cannot overwrite current state
- single-team auto-open still works after query-backed refresh
- background refresh keeps row actions enabled
- refresh button spins during teams refresh/write
- rename is optimistic and rolls back on failure
- repeated rename coalesces to latest name
- soft-delete is optimistic and remains overlaid until server marker confirms
- restore is optimistic and remains overlaid until server marker removal confirms
- interrupted delete/restore operations are recovered from cache/write-intent state
- leave remains conservative and removes team after success
- permanent delete remains conservative and purges local data after success
- scoped status badges appear for rename/delete/restore/leave/permanent delete
- cache strips transient fields

## Implementation Order

1. Add `teamKeys`, `teamsPage` state, and `team-query.js`.
2. Add `team-write-coordinator.js`.
3. Add cache sanitation and cache tests.
4. Convert `loadUserTeams` to query-backed loading.
5. Convert rename to write intents.
6. Convert soft-delete and restore to write intents.
7. Convert leave/permanent delete to conservative write-intent status flows.
8. Update Teams screen status surface, refresh spinner, and row action disabling.
9. Add legacy pending mutation migration.
10. Expand tests and run the full suite.

## Risks And Deferred Decisions

- Team soft-delete uses the GitHub organization description marker. The overlay must not clear until refreshed installation data confirms the marker changed.
- Leaving a team can remove current selected-team access and affect other pages. Keep it conservative initially.
- Permanent delete is destructive and should not become optimistic.
- Existing pending mutations in storage need compatibility handling before removing old mutation processing.
- Team access refresh is used by the Members page after role changes, so stale-auth and stale-selected-team protections need focused tests.
