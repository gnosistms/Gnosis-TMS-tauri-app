# Projects Write Coordinator Implementation Plan

## Purpose

Implement a broad Projects-page write coordinator so refresh-safe operations do not block the whole page while they sync. The coordinator should support optimistic UI, per-resource coalescing, scoped serialization, stale-refresh preservation, and granular failure handling.

This plan assumes we will use TanStack Pacer behind an app-owned adapter. Pacer should not leak into screen code or ordinary flow modules.

## Target Behavior

When the user changes the same resource repeatedly before the first write finishes, the latest intent wins.

Examples:

- Set chapter glossary to A, then quickly set the same chapter glossary to B: UI shows B immediately; the coordinator eventually persists B.
- Rename a chapter twice quickly: UI shows the second name; stale refreshes must not briefly show the old name or first rename.
- Soft-delete then restore the same chapter/project: the last lifecycle intent wins.

The page should block only genuinely conflicting or destructive actions. It should not disable all write controls just because one write is syncing.

## Non-Goals

Do not include these in the first coordinator rollout:

- project create/import
- add files
- permanent project delete
- permanent chapter delete
- repo repair/rebuild
- conflicted repo overwrite recovery
- editor row writes or virtualization behavior

Those should keep their existing stricter blockers.

## Core Model

Create `src-ui/app/project-write-coordinator.js`.

The coordinator owns desired write intents, keyed by resource field:

```js
project:title:${projectId}
project:lifecycle:${projectId}
chapter:title:${projectId}:${chapterId}
chapter:lifecycle:${projectId}:${chapterId}
chapter:glossary:${projectId}:${chapterId}
```

Each intent should include:

```js
{
  key,
  scope,
  teamId,
  projectId,
  chapterId,
  type,
  value,
  previousValue,
  status, // pending | running | confirmed | failed
  error,
  createdAt,
  updatedAt,
  version
}
```

Conflict scopes:

- `team-metadata:${installationId}` for project metadata lifecycle writes.
- `project-repo:${installationId}:${projectId}` for repo-backed chapter writes.

Rules:

- Intents with the same key coalesce. Newer intent replaces older desired value.
- Writes in the same scope serialize.
- Writes in different scopes may run concurrently.
- A failed older intent must not roll back a newer current intent.
- Refresh snapshots must apply current desired intents before reaching global state.
- An intent is confirmed only when refreshed or locally reconciled state matches the desired value.

## Pacer Boundary

Add `@tanstack/pacer`, but use it only inside the coordinator.

Expose app-level functions:

```js
export function requestProjectWriteIntent(intent, operations);
export function getProjectWriteIntent(key);
export function getProjectWriteState(key);
export function projectWriteIsActive(key);
export function projectWriteScopeIsActive(scope);
export function applyProjectWriteIntentsToSnapshot(snapshot);
export function clearConfirmedProjectWriteIntents(snapshot);
```

Internal implementation:

- Keep one Pacer `AsyncQueuer` per scope.
- Use `concurrency: 1` for each scope.
- Enqueue intent keys, not full stale intent values.
- Worker always reads the latest desired intent for the key at execution time.
- After a write finishes, compare latest desired intent against what was written.
- If the desired value changed while the write was running, enqueue the same key again.

This keeps Pacer replaceable if its beta API changes.

## Stage 1: Coordinator Skeleton

Files:

- `package.json`
- `package-lock.json`
- `src-ui/app/project-write-coordinator.js` new
- `src-ui/app/project-write-coordinator.test.js` new

Implement:

- Pacer-backed scoped queues.
- Intent storage and coalescing by key.
- Basic state selectors.
- Test-only operation injection for write workers.

Tests:

- Same key coalesces to latest value.
- Same scope serializes writes.
- Different scopes can run concurrently.
- Failed stale intent does not roll back newer intent.

Verification:

- `node --check src-ui/app/project-write-coordinator.js`
- focused coordinator tests

Rollback:

- Remove the new coordinator files and dependency.

## Stage 2: Snapshot Overlay

Files:

- `src-ui/app/project-write-coordinator.js`
- `src-ui/app/project-query.js`
- `src-ui/app/project-discovery-flow.js`
- `src-ui/app/project-flow.js`
- `src-ui/app/project-chapter-flow.js`

Implement:

- `applyProjectWriteIntentsToSnapshot(snapshot)` for:
  - project title
  - project lifecycle
  - chapter title
  - chapter lifecycle
  - chapter glossary link
- Call the overlay before every project snapshot apply path:
  - cached seed
  - offline cached path
  - repo-backed discovery apply
  - local file refresh apply
  - TanStack Query final snapshot apply

Tests:

- Stale refresh cannot undo current desired project rename/delete/restore.
- Stale refresh cannot undo current desired chapter rename/delete/restore.
- Stale refresh cannot undo current desired chapter glossary link.
- Confirmed snapshots clear matching desired intents.

Verification:

- focused coordinator/query/chapter tests

## Stage 3: Chapter Glossary Links

Files:

- `src-ui/app/project-chapter-flow.js`
- `src-ui/screens/projects.js`
- coordinator tests
- projects screen tests

Move `updateChapterGlossaryLinks` onto the coordinator.

Behavior:

- Dropdown changes apply immediately.
- Same chapter repeated changes coalesce.
- Same project writes serialize.
- Different project writes may run concurrently.
- Failure marks only the affected chapter glossary intent as failed.
- UI disables only the currently invalid/conflicting control, not all dropdowns.

Keep blocked:

- glossary changes while offline
- glossary changes when user lacks manage permission
- glossary changes on blocked repair/missing/tombstoned project states

Tests:

- Setting A then B writes final desired B.
- Failed A does not roll back B.
- Other chapter dropdowns remain enabled while one chapter is syncing.
- Refresh preserves desired glossary value.

## Stage 4: Chapter Rename, Soft-Delete, Restore

Files:

- `src-ui/app/project-chapter-flow.js`
- `src-ui/screens/projects.js`
- `src-ui/app/project-chapter-flow.test.js`
- `src-ui/screens/projects.test.js`

Move these operations onto the coordinator:

- chapter rename
- chapter soft-delete
- chapter restore

Behavior:

- Same chapter lifecycle changes coalesce.
- Rename and lifecycle have separate keys but share the same project repo scope.
- Writes in the same project serialize.
- UI disables only controls whose exact intent is running or unsafe.
- Permanent chapter delete remains blocked by refresh/write state.

Tests:

- Rename twice quickly persists latest title.
- Delete then restore leaves chapter active.
- Restore then delete leaves chapter deleted.
- Failed stale write does not roll back newer intent.
- Stale refresh preservation still works.

## Stage 5: Project Rename, Soft-Delete, Restore

Files:

- `src-ui/app/project-flow.js`
- `src-ui/app/project-query.js`
- `src-ui/screens/projects.js`
- coordinator tests
- project query tests

Move these operations onto the coordinator:

- project rename
- project soft-delete
- project restore

Behavior:

- Same project title changes coalesce.
- Same project lifecycle changes coalesce.
- Team metadata writes serialize by `team-metadata:${installationId}`.
- Project lifecycle intents continue to use metadata-first write semantics.
- Permanent project delete remains blocked by refresh/write state.

Tests:

- Rename twice quickly persists latest title.
- Soft-delete then restore leaves project active.
- Restore then soft-delete leaves project deleted.
- Metadata write failure affects only current matching intent.
- Stale refresh preservation still works.

## Stage 6: UI Blocking Policy Cleanup

Files:

- `src-ui/screens/projects.js`
- `src-ui/app/project-flow.js`
- `src-ui/app/project-chapter-flow.js`
- `src-ui/app/resource-page-controller.js` only if needed

Replace broad `projectsPage.writeState` UI blocking for coordinator-managed operations with intent-aware blocking.

Policy:

- Coordinator-managed actions are enabled during refresh.
- Coordinator-managed actions are enabled while unrelated writes are syncing.
- Same-resource changes are allowed and coalesced when safe.
- Destructive permanent operations remain blocked while refresh or any write is active.
- Repo repair/rebuild remains blocked while refresh or any write is active.
- Create/import/add files remain blocked until separately designed.

Tests:

- Project and chapter lifecycle actions remain enabled during refresh.
- Chapter glossary dropdowns remain enabled while unrelated glossary write is syncing.
- Permanent delete and repo repair stay disabled during refresh/write.
- Offline and permission blockers still apply.

## Stage 7: Persistence And Recovery

Files:

- `src-ui/app/project-cache.js`
- `src-ui/app/project-write-coordinator.js`
- tests

Persist pending coordinator intents per team/project so app restart can recover.

Rules:

- Persist desired intents, not stale queue items.
- On project page load, hydrate intents before cache seed.
- Apply hydrated intents to cached state immediately.
- Resume writes for unconfirmed intents when online and allowed.
- Clear intents only after confirmed state agrees.

Tests:

- Hydrated intent overlays cached project state.
- Hydrated intent resumes write.
- Confirmed refreshed state clears hydrated intent.

## Stage 8: Verification

Run after each stage:

```sh
node --test --loader ./src-ui/test/raw-loader.mjs src-ui/app/project-write-coordinator.test.js
node --test --loader ./src-ui/test/raw-loader.mjs src-ui/app/project-query.test.js src-ui/app/project-chapter-flow.test.js src-ui/screens/projects.test.js
```

Run before final delivery:

```sh
npm test
npm run build
```

Manual Tauri checks:

- Start Projects page refresh, then rename/delete/restore projects and chapters.
- Change a chapter glossary while another chapter glossary write is syncing.
- Change the same chapter glossary A then B quickly; final visible and persisted state should be B.
- Trigger refresh during each operation; UI should not flicker back.
- Confirm permanent delete and repo repair remain blocked during refresh/write.

## Risks

- Pacer is beta. Keep it behind the coordinator adapter.
- Latest-intent-wins is easy to get wrong on failure. Never roll back unless the failed intent is still current.
- Refresh has multiple apply paths. Missing one path will reintroduce flicker.
- Repo-backed chapter writes may expose backend assumptions about concurrent local repo access. Keep per-project repo concurrency at 1.
- Persisted pending intents need careful recovery to avoid replaying obsolete writes.

## Completion Criteria

The work is complete when:

- All coordinator-managed operations use a shared intent model.
- Same-resource repeated changes coalesce to the latest value.
- Unrelated writes do not block each other unnecessarily.
- Refresh snapshots cannot overwrite current desired local state.
- Permanent and repair actions remain conservatively blocked.
- Full tests and build pass.
