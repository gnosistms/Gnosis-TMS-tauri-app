# Glossary Write Coordinator Implementation Plan

## Purpose

Bring the Glossaries page up to the same write-orchestration standard as the Projects page:

- serialized writes where writes share a real conflict boundary
- coalesced repeated user intents where the latest value should win
- optimistic UI that refresh snapshots cannot temporarily overwrite
- granular disabled states instead of blocking the whole page
- an app-owned coordinator queue matching the Projects page pattern

This plan is for the Glossaries page only. It builds on the existing TanStack Query glossary list work in `GLOSSARY_TANSTACK_QUERY_PLAN.md`.

## Baseline Before This Work

Glossary list refresh already goes through TanStack Query:

- `src-ui/app/glossary-discovery-flow.js`
- `src-ui/app/glossary-query.js`
- `src-ui/app/query-client.js`

Glossary lifecycle writes already have optimistic TanStack Query mutations:

- rename
- soft delete
- restore

Those writes still rely on page-level state:

- `state.glossariesPage.writeState`
- `areResourcePageWriteSubmissionsDisabled(state.glossariesPage)`
- `pendingMutation` fields patched directly into query data

Before this coordinator work, the implementation preserved pending optimistic patches during query refresh with `preservePendingGlossaryLifecyclePatches(...)`, but it did not yet have a true desired-state queue. Repeated changes to the same glossary were blocked instead of being coalesced, and active writes produced broader disabled states than necessary.

## Target Behavior

The user should be able to keep working while glossary writes sync.

Examples:

- Rename glossary A to `Name 1`, then quickly rename it to `Name 2`: the UI shows `Name 2`; the coordinator eventually persists `Name 2`.
- Soft-delete a glossary, then restore it before the first write finishes: the latest lifecycle intent wins.
- Rename glossary A while glossary B is deleting: both should be allowed; writes serialize only where their scope requires it.
- Refreshing the glossary page should not briefly undo current local intents.

The page should still block operations that are not yet covered by the coordinator or that perform broader repo repair/destructive work.

## Non-Goals For The First Rollout

Keep these on the existing stricter path:

- glossary create
- glossary import
- permanent glossary delete
- glossary repo repair/rebuild
- glossary term editor writes
- editor glossary highlighting behavior
- remote conflict overwrite/recovery flows

These can be evaluated later, but they are not needed to fix lifecycle queuing and refresh-time interaction.

## Queue Boundary

Use the same app-owned coordinator pattern that is already implemented for the Projects page.

Do not add `@tanstack/pacer` in this rollout. The dependency could not be installed reliably in this environment, and the Projects page is already using a small custom coordinator with the behavior we need: per-scope serialization, same-key coalescing, stale-refresh overlays, and latest-intent-wins semantics.

Keep the coordinator boundary small and app-owned so both Projects and Glossaries can later move their internal queue implementation to Pacer if we find a concrete reason to do that. Pacer should remain an optional implementation detail, not something screen code imports directly.

New file:

- `src-ui/app/glossary-write-coordinator.js`

Suggested exports:

```js
export function requestGlossaryWriteIntent(intent, operations);
export function getGlossaryWriteIntent(key);
export function getGlossaryWriteState(key);
export function glossaryWriteIsActive(key);
export function glossaryWriteScopeIsActive(scope);
export function anyGlossaryWriteIsActive();
export function anyGlossaryMutatingWriteIsActive();
export function applyGlossaryWriteIntentsToSnapshot(snapshot);
export function clearConfirmedGlossaryWriteIntents(snapshot);
export function subscribeGlossaryWriteState(listener);
export function resetGlossaryWriteCoordinator();

export function glossaryTitleIntentKey(glossaryId);
export function glossaryLifecycleIntentKey(glossaryId);
export function glossaryRepoSyncIntentKey(repoName);
export function teamMetadataWriteScope(team);
```

Use one in-memory async queue per write scope:

```js
team-metadata:${installationId}
```

Queue entries should be intent keys, not captured stale values. When the worker runs, it must read the latest desired intent for the key.

Rules:

- same key coalesces to the latest value
- same scope serializes
- different scopes may run concurrently if introduced later
- stale failures must not roll back newer desired values
- if an intent changes while its write is running, enqueue the same key again
- confirmation happens only when refreshed or locally reconciled state matches the desired value

This should closely mirror `src-ui/app/project-write-coordinator.js` so behavior stays consistent across Projects and Glossaries.

## Intent Model

Intent keys:

```js
glossary:title:${glossaryId}
glossary:lifecycle:${glossaryId}
```

Intent shape:

```js
{
  key,
  scope,
  teamId,
  glossaryId,
  type, // glossaryTitle | glossaryLifecycle
  value,
  previousValue,
  status, // pending | running | pendingConfirmation | failed
  error,
  createdAt,
  updatedAt,
  version
}
```

Values:

```js
// glossaryTitle
{ title }

// glossaryLifecycle
{ lifecycleState: "active" | "deleted" }
```

`glossary:title` and `glossary:lifecycle` should be separate keys so a rename and lifecycle change on the same glossary can both be represented. They still share the same team-metadata scope, so backend writes remain serialized.

## Stage 1: Add Coordinator Skeleton

Files:

- `src-ui/app/glossary-write-coordinator.js` new
- `src-ui/app/glossary-write-coordinator.test.js` new

Implement:

- scoped in-memory queues matching the Projects coordinator pattern
- intent storage and same-key coalescing
- status selectors
- subscription notifications
- test-only injected `operations.run(intent)` worker

Tests:

- same glossary title key coalesces to the latest title
- same glossary lifecycle key coalesces delete/restore to the latest lifecycle state
- writes in the same team metadata scope serialize
- failed stale write does not mark a newer intent failed
- changing an intent while it is running re-enqueues the key

Verification:

- `node --check src-ui/app/glossary-write-coordinator.js`
- `node --test --loader ./src-ui/test/raw-loader.mjs src-ui/app/glossary-write-coordinator.test.js`

Rollback:

- remove the new coordinator files

## Stage 2: Snapshot Overlay

Files:

- `src-ui/app/glossary-write-coordinator.js`
- `src-ui/app/glossary-query.js`
- `src-ui/app/glossary-query.test.js`

Implement:

- `applyGlossaryWriteIntentsToSnapshot(snapshot)` overlays active intents onto query snapshots:
  - title intents patch `title`
  - lifecycle intents patch `lifecycleState`
  - pending rows get a small status field such as `pendingMutation`
- `clearConfirmedGlossaryWriteIntents(snapshot)` clears intents whose desired value is present in refreshed data
- replace `preservePendingGlossaryLifecyclePatches(...)` with coordinator overlay
- call the overlay before every query snapshot reaches global state:
  - local seed
  - query function result
  - observer notification
  - explicit `setQueryData` after fetch

Tests:

- refresh snapshot cannot undo a pending rename
- refresh snapshot cannot undo a pending delete
- refresh snapshot cannot undo a pending restore
- matching refreshed snapshot clears confirmed title intent
- matching refreshed snapshot clears confirmed lifecycle intent
- stale selected-team snapshots still no-op

Verification:

- focused glossary query/coordinator tests

## Stage 3: Move Rename Onto The Coordinator

Files:

- `src-ui/app/glossary-lifecycle-flow.js`
- `src-ui/app/glossary-query.js`
- `src-ui/app/glossary-write-coordinator.js`
- `src-ui/screens/glossaries.js`
- tests for lifecycle/query/screen

Implement:

- `submitGlossaryRename(...)` should request a `glossaryTitle` intent instead of setting `state.glossariesPage.writeState = "submitting"`.
- The coordinator worker should call the existing strict write path:
  - `commitGlossaryMutationStrict(team, mutation)`
- The optimistic apply path should:
  - close the rename modal immediately
  - update query data
  - apply the query snapshot to global state
  - render
- The failure path should:
  - mark only the title intent failed
  - keep newer title intents intact
  - show the existing notice/error text

Keep existing guards:

- offline mode
- missing GitHub App installation
- lack of manage permission
- tombstoned/missing glossary
- glossary resolution states that block lifecycle actions

Tests:

- rename applies immediately
- rename modal closes immediately
- two quick renames persist the latest title
- failed first rename does not roll back a newer title
- refresh during rename keeps the desired title visible
- other glossary lifecycle buttons are not globally disabled by this rename

Verification:

- focused lifecycle/query/screen tests
- full `npm test`

## Stage 4: Move Soft Delete And Restore Onto The Coordinator

Files:

- `src-ui/app/glossary-lifecycle-flow.js`
- `src-ui/app/glossary-query.js`
- `src-ui/app/glossary-write-coordinator.js`
- `src-ui/screens/glossaries.js`
- tests for lifecycle/query/screen

Implement:

- `deleteGlossary(...)` requests a `glossaryLifecycle` intent with `{ lifecycleState: "deleted" }`.
- `restoreGlossary(...)` requests a `glossaryLifecycle` intent with `{ lifecycleState: "active" }`.
- Snapshot overlay moves the glossary between active/deleted sections according to the desired lifecycle state.
- Same glossary delete/restore coalesces so the latest lifecycle state wins.

Tests:

- soft delete moves the glossary to the deleted section immediately
- restore moves the glossary to the active section immediately
- delete then restore leaves the glossary active
- restore then delete leaves the glossary deleted
- stale refresh cannot move the row back temporarily
- failed stale lifecycle write does not override a newer lifecycle intent

Verification:

- focused lifecycle/query/screen tests
- full `npm test`

## Stage 5: Granular Disabled States

Files:

- `src-ui/screens/glossaries.js`
- `src-ui/app/glossary-lifecycle-flow.js`
- `src-ui/app/glossary-write-coordinator.js`
- screen tests

Replace broad page-write blocking with specific guards.

Enable during ordinary query refresh:

- open glossary
- download glossary, unless offline or missing resolution
- show/hide deleted glossaries
- rename
- soft delete
- restore

Enable while another glossary lifecycle write is syncing:

- rename a different glossary
- soft delete a different glossary
- restore a different glossary

Keep blocked:

- create/import while `state.glossariesPage.isRefreshing` or any glossary mutating write is active
- permanent delete while refresh or any glossary mutating write is active
- repair/rebuild while refresh or any glossary mutating write is active
- actions for the exact glossary field whose intent is running, if the action would conflict with that same key

Implementation guidance:

- `lifecycleActionsDisabled` should no longer be a single page-level boolean.
- Pass per-row state into `renderGlossaryCard(...)`, for example:
  - `titleWriteActive`
  - `lifecycleWriteActive`
  - `heavyWriteActionsDisabled`
- Keep `areResourcePageWritesDisabled(state.glossariesPage)` only for heavy operations.
- Use coordinator selectors for lifecycle operations.

Tests:

- refresh does not disable rename/delete/restore
- title write on glossary A does not disable rename/delete/restore on glossary B
- lifecycle write on glossary A does not disable lifecycle actions on glossary B
- permanent delete remains disabled during refresh
- import/create remain disabled during refresh
- repair/rebuild remain disabled during refresh

Verification:

- focused screen tests
- full `npm test`

## Stage 6: Post-Write Refresh And Confirmation Cleanup

Files:

- `src-ui/app/glossary-query.js`
- `src-ui/app/glossary-write-coordinator.js`
- `src-ui/app/glossary-lifecycle-flow.js`

Implement:

- after a coordinator write succeeds, invalidate `glossaryKeys.byTeam(teamId)`
- do not force a second refetch if an active observer already refetches
- clear matching intents when refreshed query data confirms the desired value
- keep failed intents visible enough for retry/error display, but do not block unrelated rows

Tests:

- successful write invalidates once
- active observer path does not double refetch
- inactive observer path fetches when needed
- confirmed intents clear after matching refresh
- failed intent on one glossary does not disable unrelated glossary actions

Verification:

- focused query/coordinator tests
- full `npm test`
- `npm run build`

## Manual QA

Use the Tauri dev app and verify:

- page refresh keeps glossary list visible
- rename during refresh closes the modal immediately and stays visible
- delete during refresh moves the row to deleted and does not bounce back
- restore during refresh moves the row to active and does not bounce back
- repeated rename on the same glossary lands on the latest name
- delete then restore on the same glossary lands in the restored state
- operations on different glossaries do not disable each other
- import/create/permanent delete/repair/rebuild still block during refresh
- offline mode still blocks writes
- permission restrictions still apply

## Rollout Order

1. Coordinator skeleton with tests.
2. Snapshot overlay with no user-visible behavior change.
3. Rename through the coordinator.
4. Soft delete and restore through the coordinator.
5. Relax disabled states for coordinator-backed lifecycle actions.
6. Clean up old `pendingMutation` preservation once coordinator overlay owns it.

Each stage should be committed separately if possible. The safest checkpoint is after Stage 2, because it adds stale-refresh protection before enabling more concurrent actions.
