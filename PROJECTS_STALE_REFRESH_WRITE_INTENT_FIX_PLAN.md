# Projects Stale Refresh Write Intent Fix Plan

## Objective

Prevent stale project refreshes from undoing optimistic or recently completed Projects page writes.

The restore bug showed the core risk: a refresh snapshot can briefly match a desired local state before the full write flow is complete, causing the write intent to be cleared too early. Once the intent is gone, a later stale refresh can overwrite the visible state.

This plan covers the other Projects page operations that use the same write-intent overlay path:

- project rename
- project soft-delete
- chapter rename
- chapter soft-delete
- chapter restore
- chapter glossary link change

Project restore is the first confirmed failure and should remain covered by the same shared fix.

## Current Flow

Projects page query refreshes eventually call `applyProjectWriteIntentsToSnapshot` before applying data to visible state. That overlay keeps local intent state visible when server or repo refresh data is stale.

Project and chapter operations use `requestProjectWriteIntent` in:

- `src-ui/app/project-flow.js`
- `src-ui/app/project-chapter-flow.js`

The shared coordinator logic lives in:

- `src-ui/app/project-write-coordinator.js`
- `src-ui/app/write-intent-coordinator.js`

The narrowest safe fix is to ensure project write intents are only cleared after:

1. the write has completed its `run` callback,
2. the intent has moved to `pendingConfirmation`,
3. a later snapshot confirms the intended state.

Matching snapshots must not clear intents while the intent is still `pending` or `running`.

## Non-Goals

- Do not rewrite project discovery or repo sync.
- Do not introduce a new queue implementation.
- Do not change virtualization or editor row rendering.
- Do not enable heavy operations during refresh.
- Do not change permanent project delete, project create/import, or add-files behavior in this plan.

## Stage 1: Lock The Shared Confirmation Rule

Implementation:

- In `src-ui/app/project-write-coordinator.js`, keep `clearConfirmedProjectWriteIntents` limited to intents whose status is `pendingConfirmation`.
- Do not clear `pending`, `running`, or `failed` intents from a matching refresh snapshot.
- Keep the same behavior for all project intent types:
  - `projectTitle`
  - `projectLifecycle`
  - `chapterTitle`
  - `chapterLifecycle`
  - `chapterGlossary`

Tests:

- Add or keep a project restore regression proving a matching active snapshot does not clear a running restore intent.
- Add a project soft-delete version proving a matching deleted snapshot does not clear a running soft-delete intent.
- Add a project rename version proving a matching title snapshot does not clear a running rename intent.

Success criteria:

- Running project lifecycle/title intents survive matching snapshots.
- Once the write reaches `pendingConfirmation`, a matching snapshot clears the intent.

## Stage 2: Add Chapter Lifecycle Regression Coverage

Implementation:

- Avoid changing `project-chapter-flow.js` unless a test shows it bypasses the shared overlay.
- Use `requestProjectWriteIntent` directly in coordinator tests where possible so the tests stay focused on stale-refresh behavior.

Tests:

- Chapter rename:
  - running `chapterTitle` intent stays active after a matching chapter name snapshot.
  - stale snapshot with the old chapter name is overlaid with the desired name.
  - after write success, a matching snapshot clears the intent.

- Chapter soft-delete:
  - running `chapterLifecycle` intent with `{ status: "deleted" }` stays active after a matching deleted snapshot.
  - stale active snapshot is overlaid as deleted with `pendingMutation: "softDelete"`.
  - after write success, a matching snapshot clears the intent.

- Chapter restore:
  - running `chapterLifecycle` intent with `{ status: "active" }` stays active after a matching active snapshot.
  - stale deleted snapshot is overlaid as active with `pendingMutation: "restore"`.
  - after write success, a matching snapshot clears the intent.

Success criteria:

- Chapter lifecycle and title writes have the same stale-refresh protection as project restore.

## Stage 3: Add Chapter Glossary Link Regression Coverage

Implementation:

- Keep the existing `chapterGlossary` overlay behavior unless tests expose a merge bug.
- Confirm `glossaryLinksEqual` treats the intended glossary link and the refreshed snapshot consistently.

Tests:

- Running glossary link intent is not cleared by a matching snapshot.
- Stale snapshot with the old glossary link is overlaid with the new glossary link and `pendingGlossaryMutation: true`.
- Setting a chapter glossary to `null` has the same protection as setting it to a glossary.
- After write success, a matching snapshot clears the intent.

Success criteria:

- Glossary selectors can remain enabled during refresh without stale refreshes reverting the selected link.

## Stage 4: Confirm Query Refresh Integration

Implementation:

- Review `src-ui/app/project-query.js` and `src-ui/app/project-discovery-flow.js` for all paths that apply project snapshots.
- Ensure every project refresh path overlays current project write intents before applying visible state.
- If a path applies raw project snapshots directly, route it through the same preservation/overlay helper instead of adding a parallel implementation.

Tests:

- Add query-level tests where useful:
  - project rename local intent survives a stale query refresh.
  - project soft-delete local intent survives a stale query refresh.
  - chapter lifecycle intent survives a stale query refresh.
  - chapter glossary link intent survives a stale query refresh.

Success criteria:

- Both TanStack query observer refreshes and direct repo-backed refresh stages preserve active write intents.

## Stage 5: Verify Real Operation Flows

Implementation:

- Only if coordinator/query tests expose a gap, add operation-level tests for:
  - `submitProjectRename`
  - `deleteProject`
  - `restoreProject`
  - `submitChapterRename`
  - `deleteChapter`
  - `restoreChapter`
  - `updateChapterGlossaryLinks`

Tests should verify:

- optimistic state appears immediately,
- stale refresh cannot revert it while the write is running,
- the intent clears only after the write completes and refreshed state agrees,
- errors leave an actionable visible error and do not silently clear a newer intent.

Success criteria:

- The user-visible operations match the coordinator invariants.

## Stage 6: Manual QA Checklist

Run the Tauri dev app and test on the Projects page:

- Rename a project while refresh is active.
- Soft-delete a project while refresh is active.
- Restore a project while refresh is active.
- Rename a chapter while refresh is active.
- Soft-delete a chapter while refresh is active.
- Restore a chapter while refresh is active.
- Change a chapter glossary while refresh is active.
- Change a chapter glossary twice quickly on the same chapter.

Expected behavior:

- The optimistic result appears immediately.
- Refresh spinner can run in the background.
- The item does not flicker back to the stale server/repo state.
- The operation eventually settles with the intended state.
- If the write fails, the UI keeps the latest local intent or shows a clear error instead of silently reverting to stale data.

## Verification Commands

Run focused tests first:

```sh
node --test --loader ./src-ui/test/raw-loader.mjs src-ui/app/project-write-coordinator.test.js src-ui/app/project-query.test.js src-ui/app/project-chapter-flow.test.js src-ui/screens/projects.test.js
```

Then run full verification:

```sh
npm test
npm run build
```

## Completion Definition

This work is complete when:

- every project/chapter write-intent type has stale-refresh regression coverage,
- active writes cannot be cleared by matching snapshots until `pendingConfirmation`,
- stale refresh snapshots are overlaid consistently across query and direct refresh paths,
- project restore, soft-delete, rename, chapter lifecycle, and chapter glossary link changes no longer flicker back to old state during refresh.
