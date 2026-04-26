# TanStack Query Glossaries Page Plan

## Goal

Use `@tanstack/query-core` to manage glossary-list loading, refresh, mutation invalidation, and small optimistic updates on the glossaries page without changing glossary repo or team-metadata semantics.

This should be an orchestration refactor, not a data-model rewrite. Git, local repo, remote repo, metadata repair, tombstone, and conflict logic stay in the existing glossary/team-metadata flows.

## Query Infrastructure

- Add `@tanstack/query-core`.
- Create a small framework-agnostic wrapper, likely `src-ui/app/query-client.js`.
- Export:
  - `queryClient`
  - glossary query key helpers such as `glossaryKeys.byTeam(teamId)`
  - a helper to subscribe a query observer and call `render()`
- Keep this independent of React. Gnosis TMS remains a plain JavaScript app.

## Glossary Query Shape

Use one page-level query:

```js
["glossaries", teamId]
```

Query result shape:

```js
{
  glossaries,
  repoSyncByRepoName,
  discovery: {
    status,
    brokerWarning,
    recoveryMessage,
    error
  }
}
```

The query function should reuse existing logic:

- `loadRepoBackedGlossariesForTeam(team, options)`
- `listLocalGlossarySummariesForTeam(team)` only for cache/bootstrap fallback
- existing repair and recovery behavior in `glossary-repo-flow.js`

Do not move GitHub/local repo conflict logic into TanStack Query.

## State Bridge

For the first implementation, keep `src-ui/screens/glossaries.js` mostly unchanged.

Add an adapter such as:

```js
applyGlossariesQuerySnapshotToState(snapshot, { teamId, isFetching })
```

It updates:

- `state.glossaries`
- `state.glossaryRepoSyncByRepoName`
- `state.glossaryDiscovery`
- `state.glossariesPage.isRefreshing`

The adapter must guard against stale async results. If `state.selectedTeamId !== teamId`, it must no-op. Recovery callbacks, observer notifications, and mutation rollback/apply paths must pass the same `teamId` guard so an old glossary refresh cannot overwrite a newly selected team's page state.

This lets Query own fetching/invalidation while the screen keeps reading the existing global state.

## Loading Flow

Refactor `loadTeamGlossaries` into a thin Query wrapper:

- On page open:
  - set selected team
  - seed query data from existing cached `state.glossaries` if available
  - if visible state is empty and `preserveVisibleData` is false, load `listLocalGlossarySummariesForTeam(team)` and seed/apply that local snapshot before the repo-backed query refresh
  - call `queryClient.fetchQuery(...)` or `queryClient.refetchQueries(...)`
- While fetching:
  - keep showing cached/local data
  - derive refresh state from Query `isFetching`
- On success:
  - apply query snapshot to state
  - persist glossary cache as today
- On error:
  - keep visible cached data if present
  - show existing recovery/error UI

Preserve current behavior: cached/local data first, repo-backed refresh second. A cold open must still show local glossary summaries before remote repo discovery finishes.

## Mutations

Create scoped mutation helpers for:

- rename glossary
- soft delete glossary
- restore glossary

Query-backed glossary lifecycle mutations should use the team metadata mutation scope:

```js
scope: { id: `team-metadata:${team.installationId}` }
```

This serializes the TanStack-managed glossary lifecycle mutations and avoids two optimistic query-backed metadata mutations racing each other.

The shared team metadata helpers now also route record writes through a central per-installation queue. Query-backed glossary lifecycle mutations, project writes, glossary import/create, and permanent delete all serialize at the team-metadata write boundary when they call `upsert*MetadataRecord` or `delete*MetadataRecord`.

Do not treat this as global serialization for unrelated repo operations. Refresh, repo sync, repair scans, and local/remote repository mutations still have their own orchestration and must keep their existing guards until they are explicitly migrated.

Each mutation should still call existing backend-facing code:

- `commitGlossaryMutationStrict(...)`
- `upsertGlossaryMetadataRecord(...)`
- existing local repo cleanup or purge only where already used

## Conservative Optimistic Updates

Only make reversible UI fields optimistic:

- Rename: patch `title`
- Soft delete: set `lifecycleState: "deleted"`
- Restore: set `lifecycleState: "active"`

Do not optimistically handle:

- permanent delete
- import/create completion
- repo repair or rebuild
- repo identity changes
- source/target language changes
- GitHub repo IDs, full names, or default branch changes

Mutation lifecycle:

```js
onMutate:
  cancel glossary query
  snapshot previous query data
  apply optimistic patch
  mark row pendingMutation

onError:
  restore previous query data
  show error/notice

onSettled:
  invalidate glossary query
```

Rows with a pending mutation can disable destructive actions or show subtle `Saving...` state.

Use one post-mutation refresh path. Prefer `invalidateQueries` on settle when an active observer exists; only force an explicit refetch if the implementation has no active glossary observer.

## Conflict Policy

TanStack Query provides rollback, refetch, and invalidation mechanics. Conflict semantics still belong to the app.

Rules:

- If backend write succeeds, optimistic state becomes real after refetch.
- If backend reports push conflict or metadata conflict, rollback and refetch.
- If remote state changed but the existing backend flow can replay the action safely, let the backend do that.
- If local rename conflicts with remote rename, rollback, refetch, and let the user retry.
- If remote tombstone/permanent delete is detected, tombstone wins; remove the local visible row and notify.
- If repo identity differs, block optimistic retry and show repair/rebuild state.

## Refresh-Time Action Policy

Do not use one generic "page is busy" state for every button.

During glossary query refresh:

- Keep read-only/navigation actions enabled:
  - open glossary
  - download glossary, unless offline or the glossary resolution is missing
  - show/hide deleted glossaries
- Keep query-backed glossary lifecycle actions enabled when no other write is in progress:
  - rename
  - soft delete
  - restore
- Keep heavier metadata/repo writes disabled:
  - import/create
  - repair/rebuild
  - permanent delete

Reason: TanStack Query serializes query-backed lifecycle mutations and the shared team metadata helpers now serialize record writes. Query refreshes also preserve pending optimistic lifecycle patches so refresh snapshots do not briefly overwrite those local updates. Heavier repo operations still wait because refresh can perform repo sync, metadata repair, tombstone finalization, and local state reconciliation outside that record-write boundary.

Implementation guidance:

- Treat `state.glossariesPage.isRefreshing` as a blocker only for heavier metadata/repo writes.
- Treat `state.glossariesPage.writeState !== "idle"` as the blocker for query-backed lifecycle writes.
- Read-only glossary page actions should not depend on `areResourcePageWritesDisabled(state.glossariesPage)`.
- Repair/rebuild actions are writes and should use the write-action guard even though they appear in resolution state boxes.

Optional later improvement:

- Add `metadataRevision` or team-metadata repo head SHA to query data and mutation input so writes can be conditional against the user-visible base revision.

## Tests

Add unit tests for:

- Query adapter maps snapshot into `state.glossaries`.
- Query adapter ignores stale snapshots for non-selected teams.
- Cold glossary page load seeds local summaries before repo-backed refresh.
- Rename optimistic patch updates cache immediately.
- Rename failure rolls back cache.
- Delete/restore optimistic patches move rows between active/deleted sections.
- Mutation settle invalidates or refetches glossary query exactly once.
- Concurrent query-backed glossary metadata mutations use the same mutation scope.
- Permanent delete remains non-optimistic.
- During refresh, open/download/show-deleted and query-backed rename/delete/restore remain enabled while import/create/repair/rebuild/permanent-delete stay disabled.
- Refresh snapshots preserve pending optimistic rename/delete/restore patches.

## Rollout

Start with rename only. It has the smallest blast radius.

Then add:

1. soft delete
2. restore
3. keep permanent delete on the current pessimistic path

Do not migrate the projects page until the glossary page proves the Query pattern is simpler than the current custom controller.
