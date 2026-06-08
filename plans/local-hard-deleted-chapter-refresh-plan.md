# Local Hard-Deleted Project Files Refresh Plan

Status: Implemented in `codex/local-hard-delete-chapter-overlay`.

## Problem

Hard-deleting a project file is intended to be local-only. The app already records
local hard-delete tombstones in `src-ui/app/local-hard-delete-store.js`, and
`permanentlyDeleteChapter` writes a `resourceKind: "chapter"` tombstone before
removing the file from visible project state.

The bug is that a later Projects refresh can reintroduce the same soft-deleted
file when the remote project repo still contains it. Git is doing the expected
thing: the remote tracked file still exists, so pull/list operations see it
again. The app must treat the local hard-delete tombstone as an overlay on top of
remote/local repo listings.

Do not try to solve this with Git ignore mechanics. `.gitignore` does not apply
to tracked files, and `skip-worktree`/`assume-unchanged` are fragile local index
hints, not a durable application policy.

## Existing Code

- `src-ui/app/local-hard-delete-store.js`
  - Stores tombstones by active login.
  - Supports `resourceKind` values including `project`, `chapter`, `editorRow`,
    and top-level repo resources.
  - Provides `filterLocalHardDeletedResources` and
    `clearRestoredLocalHardDeleteTombstones`.
- `src-ui/app/project-chapter-flow.js`
  - `permanentlyDeleteChapter` writes a `chapter` tombstone.
  - It immediately removes the chapter from state, persists the visible project
    snapshot, and updates the query cache.
- `src-ui/app/project-discovery-flow.js`
  - `applyLocalProjectHardDeleteState` filters locally hard-deleted projects.
  - `mergeProjectsWithLocalFiles` filters locally hard-deleted chapters, but only
    for file-listing merge paths.

## Root Cause

Chapter tombstones are applied too narrowly. The filtering happens while merging
local file listings, but project snapshots can enter state/cache through multiple
paths:

- cached project snapshots,
- metadata-backed project snapshots,
- repair/recovery snapshots,
- final project-file refresh snapshots,
- query cache snapshot application.

Any path that carries a deleted chapter but does not pass through
`mergeProjectsWithLocalFiles` can re-show a locally hard-deleted chapter.

## Design

Create one project-snapshot overlay helper that applies all local hard-delete
rules for project page data:

```js
applyLocalProjectSnapshotHardDeleteState(selectedTeam, snapshot)
```

It should:

1. Filter locally hard-deleted deleted projects exactly as
   `applyLocalProjectHardDeleteState` does today.
2. For every remaining project in `items` and `deletedItems`, filter nested
   `chapters` with `resourceKind: "chapter"` when `chapter.status === "deleted"`.
3. Clear a chapter tombstone only when the incoming chapter is active again
   (`chapter.status !== "deleted"`), preserving the existing restored-resource
   behavior.
4. Preserve project and chapter object identity where possible when no filtering
   occurs, to avoid unnecessary render churn.

Use this helper everywhere project snapshots are published or applied, so the
invariant is:

> A local chapter hard-delete tombstone always wins over a remote soft-deleted
> chapter unless the remote chapter becomes active again.

## Implementation Steps

1. Replace `applyLocalProjectHardDeleteState` in
   `src-ui/app/project-discovery-flow.js` with the broader
   `applyLocalProjectSnapshotHardDeleteState`.

2. Have the new helper call a small nested helper, for example:

   ```js
   function applyLocalChapterHardDeleteState(selectedTeam, project) { ... }
   ```

   This should call:

   - `clearRestoredLocalHardDeleteTombstones(selectedTeam, "chapter", chapters, {
       isActive: (chapter) => chapter?.status !== "deleted",
     })`
   - `filterLocalHardDeletedResources(selectedTeam, "chapter", chapters, {
       isDeleted: (chapter) => chapter?.status === "deleted",
     })`

3. Update all current `applyLocalProjectHardDeleteState(...)` call sites in
   `project-discovery-flow.js` to use the broader helper.

4. Keep the existing chapter filtering inside `mergeProjectsWithLocalFiles` only
   if it still prevents intermediate progress snapshots from showing deleted
   files. Otherwise, route that function through the new nested helper to avoid
   duplicate logic.

5. Add a final guard in `src-ui/app/project-query.js` if needed:

   - Prefer doing the normalization before project query snapshots are created.
   - If tests show a query cache path can still apply a stale snapshot directly,
     export a pure helper and apply it in `applyProjectsQuerySnapshotToState`
     before `applyProjectSnapshotToState`.

6. Ensure `persistProjectsForTeam(selectedTeam)` persists the filtered visible
   snapshot after refresh, so the next app launch does not show locally
   hard-deleted chapters from cache.

## Tests

Add focused coverage before or with the behavior change:

1. `project-discovery-flow` or `project-query` test:
   - Given a stored local hard-delete tombstone for chapter `deleted-chapter`.
   - When an incoming project snapshot contains that chapter with
     `status: "deleted"`.
   - Then the applied state and persisted query snapshot do not contain it.

2. Refresh/reappearance regression:
   - Start with a project whose deleted chapter was locally hard-deleted.
   - Simulate a refresh result that lists the same deleted chapter from disk/remote.
   - Assert the Projects screen does not render `delete-deleted-file:<id>` or the
     chapter title.

3. Restored remote behavior:
   - Given a chapter tombstone.
   - When the incoming chapter has `status: "active"`.
   - Then the tombstone is cleared and the active chapter is visible.

4. Non-deleted chapters are unaffected:
   - No tombstone or nonmatching tombstones should preserve the chapter list.

5. Existing project-level local hard-delete tests should remain green.

## Verification

Run:

```bash
node --test --loader ./src-ui/test/raw-loader.mjs src-ui/app/project-chapter-flow.test.js
node --test --loader ./src-ui/test/raw-loader.mjs src-ui/app/project-query.test.js
node --test --loader ./src-ui/test/raw-loader.mjs src-ui/screens/projects.test.js
npm test
npm run audit:unused
```

`npm run audit:unused` currently has known baseline findings; the change should
not add new findings.

Implementation verification:

- `node --test --loader ./src-ui/test/raw-loader.mjs src-ui/app/project-query.test.js` — passed.
- `node --test --loader ./src-ui/test/raw-loader.mjs src-ui/app/project-chapter-flow.test.js` — passed.
- `node --test --loader ./src-ui/test/raw-loader.mjs src-ui/screens/projects.test.js` — passed.
- `npm test` — passed.
- `npm run audit:unused` — still fails on the existing baseline; no new unused export was added.

## Non-Goals

- Do not use `.gitignore`, sparse checkout, `skip-worktree`, or
  `assume-unchanged` for this behavior.
- Do not delete the file from the remote project repo.
- Do not push local hard-delete tombstones to GitHub.
- Do not change soft-delete/restore behavior for users who have not performed a
  local hard delete.
