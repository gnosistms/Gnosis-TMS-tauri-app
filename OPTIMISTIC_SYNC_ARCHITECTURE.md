# Gnosis TMS Optimistic Sync Architecture

## Purpose

This document defines the frontend state model for resources that:

- must feel immediate in the UI
- must persist locally on the device
- must sync with GitHub through the broker in the background
- must support different permissions per user role

The immediate target resources are:

- teams
- projects

This is the refactor target for the current Tauri app.

## Product Goals

The user experience should feel like Gmail:

1. User action changes the UI immediately.
2. Local persistence is updated immediately.
3. The broker/GitHub update happens afterward in the background.
4. The user only notices network delay if something fails.

At the same time, the app must remain trustworthy:

1. Local state must survive app restart.
2. A stale server response must not overwrite a newer local action.
3. Permissions must be explicit and consistent.
4. Teams and projects should share the same frontend mutation model even if their backend APIs differ.

## Core Rule

Frontend behavior is standardized.

Backend implementation details are hidden behind per-resource adapters.

The UI should think in shared verbs:

- rename
- soft delete
- restore
- hard delete
- leave
- create

The UI should not care whether the backend action is implemented by:

- editing org description
- updating a repo custom property
- deleting a repo
- deleting an organization
- leaving an organization

## State Layers

Each managed resource collection has three layers of state.

### 1. Persisted Base Snapshot

This is the last server-confirmed resource list stored locally.

Examples:

- stored team records
- stored project cache

The app loads this immediately on startup and shows it before sync completes.

### 2. In-Memory View State

This is what the UI is currently rendering.

It may include optimistic local mutations that have not yet been confirmed by the backend.

This is the source of truth for the rendered screen.

### 3. Persisted Pending Mutations

This is the list of local actions that have been applied optimistically but are not yet confirmed.

Examples:

- rename team A to "New Name"
- soft-delete project B
- restore team C

This must be persisted, not just kept in memory.

Reason:

- if the app closes mid-sync, the app must reopen into the same local user-visible state
- then continue reconciliation safely

## Collection Shape

Each resource collection should use the same logical shape.

```js
{
  items: [],
  deletedItems: [],
  pendingMutations: [],
  syncStatus: "idle" | "syncing" | "error",
  lastSyncedAt: null,
  localVersion: 0
}
```

Field meanings:

- `items`
  - active visible resources
- `deletedItems`
  - soft-deleted visible resources
- `pendingMutations`
  - optimistic local actions still awaiting confirmation
- `syncStatus`
  - current background refresh status
- `lastSyncedAt`
  - timestamp of last successful server reconciliation
- `localVersion`
  - incremented whenever a local optimistic mutation is applied

## Resource Store Contract

Teams and projects should both plug into the same store contract.

Each resource store must provide:

1. `loadPersisted()`
2. `savePersisted(snapshot)`
3. `loadPendingMutations()`
4. `savePendingMutations(mutations)`
5. `fetchRemote()`
6. `applySoftDelete(item)`
7. `applyRestore(item)`
8. `applyRename(item, payload)`
9. `commitMutation(mutation)`
10. `rollbackMutation(mutation)`
11. `classifyDeleted(item)`
12. `sortItems(items)`

The shared store machinery handles:

- optimistic updates
- persistence
- race protection
- reconciliation
- rollback

The resource adapter handles:

- backend-specific broker calls
- resource-specific field mapping
- resource-specific deleted marker rules

## Mutation Lifecycle

Every mutation follows the same lifecycle.

### Step 1. User Action

The user clicks:

- delete
- restore
- rename
- create
- leave

### Step 2. Optimistic Apply

The store:

- applies the mutation to in-memory view state immediately
- increments `localVersion`
- records the mutation in `pendingMutations`
- saves both the new view snapshot and pending mutation list locally
- re-renders immediately

This must happen before any network request.

### Step 3. Background Commit

The store starts the backend adapter call in the background.

Examples:

- team soft delete -> patch org description with `[DELETED]`
- project soft delete -> patch repo custom property to `deleted`

### Step 4. Success

If the backend commit succeeds:

- remove the mutation from `pendingMutations`
- update persisted base snapshot to match the confirmed optimistic state
- keep the UI as-is

### Step 5. Failure

If the backend commit fails:

- roll back the optimistic change
- remove the failed mutation from `pendingMutations`
- save the rollback to local persistence
- show a user-visible error

## Refresh Lifecycle

Refresh is separate from mutation.

### Step 1. Start Refresh

When a screen loads or the user clicks `Check for updates`:

- keep the current local view visible
- set subtitle state to `Updating`
- record the `localVersion` at refresh start

### Step 2. Fetch Remote Snapshot

The adapter fetches the current server state.

### Step 3. Ignore Stale Results

If the collection's current `localVersion` is newer than the version recorded at refresh start:

- do not blindly apply the fetched result
- rebase the server result against current pending mutations

This prevents older refreshes from overwriting newer local user actions.

### Step 4. Reconcile

Reconciliation rule:

- start from the fetched remote snapshot
- reapply all still-pending optimistic mutations on top of it
- then replace in-memory view state with the merged result

### Step 5. Persist

After successful reconciliation:

- save the new base snapshot
- save the reapplied pending mutation list
- clear sync error state
- mark `lastSyncedAt`

## Permission Model

Permissions must be explicit and attached to each loaded item as capabilities.

The UI should not infer permissions from scattered role checks.

Each resource item should carry:

```js
capabilities: {
  canRename: false,
  canSoftDelete: false,
  canRestore: false,
  canHardDelete: false,
  canLeave: false,
  canCreateChild: false
}
```

### Roles

GitHub roles are mapped to app roles:

- owner
- admin
- translator

GitHub `member` is treated as app `translator`.

### Team Capabilities

Everyone:

- can create new team

Owner:

- can rename team
- can soft-delete team
- can restore team
- can hard-delete team

Admin:

- can leave team

Translator:

- can leave team

### Project Capabilities

Owner:

- can create new project
- can rename project
- can soft-delete project
- can restore project
- can hard-delete project

Admin:

- can create new project
- can rename project
- can soft-delete project
- can restore project

Translator:

- no project mutation actions

## UI Rules

UI components should remain dumb.

They should:

- render from current collection state
- show buttons only if capability flags allow them
- dispatch semantic actions

Examples:

- `team.softDelete`
- `team.restore`
- `team.hardDelete`
- `team.leave`
- `project.softDelete`
- `project.restore`

They should not:

- talk directly to broker details
- interpret GitHub-specific metadata formats
- manage rollback logic
- implement role logic inline

## Backend Mapping

The frontend contract stays the same even when backend behavior differs.

### Teams

Shared soft-delete marker:

- if org description begins with `[DELETED]`, the team is soft-deleted

Team adapter operations:

- rename -> update organization name
- soft delete -> prefix description with `[DELETED]`
- restore -> remove `[DELETED]` prefix
- hard delete -> delete organization
- leave -> remove current user from organization

### Projects

Shared soft-delete marker:

- repo custom property `gnosis_tms_repo_status = deleted`

Project adapter operations:

- rename -> rename/update repo metadata
- soft delete -> set repo property to `deleted`
- restore -> set repo property to `active`
- hard delete -> delete repository

## Persistence Rules

The following must be persisted locally:

- base snapshot
- current optimistic snapshot
- pending mutations
- last successful sync metadata

The user must be able to close the app mid-sync and reopen into the same visible state.

On startup:

1. load persisted optimistic snapshot
2. render immediately
3. load pending mutations
4. begin background reconciliation

## Error Handling Rules

Errors should not destroy useful local UI state.

### Mutation failure

- rollback the specific mutation
- keep the rest of the current collection visible
- surface a focused error

### Refresh failure

- keep current local view visible
- do not replace with empty/error-only state if cached data exists
- show refresh error separately from content

### Auth expiry

- treat as a first-class structured auth error
- clear stale session
- return user to sign-in flow
- do not present generic resource failure if the real issue is expired auth

## Migration Plan

Refactor in this order:

1. Define the shared optimistic collection store interface.
2. Move projects onto the full shared store contract.
3. Move teams onto the same contract.
4. Replace ad hoc role checks with explicit item capabilities.
5. Persist pending mutations for both collections.
6. Rework refresh to always rebase server data onto pending mutations.
7. Only after this, continue the org-creation polling work.

## Non-Goals

This design does not require:

- immediate server-side truth after every click
- server-side session revocation
- a database for projects
- identical backend implementation for teams and projects

It does require:

- identical frontend mutation semantics
- persistent optimistic state
- explicit reconciliation rules

## Success Criteria

This design is successful when:

1. Delete, restore, rename, and create feel immediate for both teams and projects.
2. Refresh never causes items to flicker back to an older state.
3. App restart preserves the same visible local state.
4. Permissions are obvious in code and consistent in UI.
5. Teams and projects no longer need separate ad hoc race-condition fixes.
