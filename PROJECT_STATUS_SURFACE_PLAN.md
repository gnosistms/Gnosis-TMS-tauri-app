# Project Status Surface Implementation Plan

## Goal

Keep separate status semantics, but render them through one consistent status surface so background work is never hidden by short notices.

Current state sources should remain separate:

- `statusBadges.left` for notices, errors, completion messages, and blockers.
- `statusBadges.right` for scoped background work.

The presentation should change so active scoped background work and notices can both be visible.

## Stage 1: Unified Status Surface Rendering

Change `src-ui/app/status-feedback.js`:

- Add `getNoticeBadgeItem()`.
- Add `getScopedSyncBadgeItem(scope)`.
- Add `getStatusSurfaceItems(scope = null)`.
- Return items shaped like:

```js
{
  id: "projects-sync",
  kind: "sync" | "notice",
  text: "...",
  scope: "projects" | null,
}
```

- Keep existing `showNoticeBadge`, `showScopedSyncBadge`, `clearNoticeBadge`, and `clearScopedSyncBadge` behavior unchanged initially.

Change `src-ui/lib/ui.js`:

- Replace `renderFloatingBadge({ pageSync, syncBadgeText, noticeText })` with stack rendering:

```js
renderFloatingStatusSurface({ pageSync, syncBadgeText, noticeText, statusItems })
```

- If `statusItems` exists, render all items in order.
- Preserve fallback behavior for screens not yet migrated:
  - sync text from `pageSync`
  - notice text
- Add CSS classes:
  - `team-ui-debug--stack`
  - `team-ui-debug__item`
  - `team-ui-debug__item--sync`
  - `team-ui-debug__item--notice`

Change `src-ui/screens/projects.js`:

- Import `getStatusSurfaceItems`.
- Pass this into `pageShell`:

```js
statusItems: getStatusSurfaceItems("projects")
```

- Keep `syncBadgeText` and `noticeText` temporarily for compatibility.

## Stage 2: Project Status Helper API

Change `src-ui/app/project-chapter-flow.js`:

- Add wrapper helpers:

```js
export function showProjectsStatus(render, text) {
  showScopedSyncBadge("projects", text, render);
}

export function clearProjectsStatus(render) {
  clearScopedSyncBadge("projects", render);
}

export function showProjectsNotice(render, text, durationMs) {
  showNoticeBadge(text, render, durationMs);
}
```

- Keep `setProjectUiDebug` as an alias during migration, but stop adding new uses.

Change `src-ui/app/project-flow.js`:

- Replace local `setProjectsPageProgress()` so it uses `showProjectsStatus`, not `showNoticeBadge`.
- `clearProgress` should clear only projects scoped status, not `clearNoticeBadge`.

## Stage 3: Resource Page Write Integration

Change `src-ui/app/resource-page-controller.js`:

- Keep generic controller logic, but support optional lifecycle callbacks:

```js
onMutationStarted
onMutationFinished
onRefreshStarted
onRefreshFinished
```

- Use these only if provided.
- Do not hard-code project text here.

Update project callers using `submitResourcePageWrite`:

- Project creation
- Permanent project delete

For these calls, pass `progressLabels.submitting` and `progressLabels.refreshing` consistently.

## Stage 4: Project Creation

Change `src-ui/app/project-flow.js`:

- In `submitProjectCreation`, add:

```js
progressLabels: {
  submitting: "Creating project...",
  refreshing: "Refreshing project list...",
}
```

- Inside `completeProjectCreateSynchronously`, add project status updates around each major step:
  - before remote repo create: `Creating project repo...`
  - before local setup: `Initializing local project...`
  - before metadata save if present: `Saving project metadata...`
- On success, show notice:
  - `Created project ${result.title}`

## Stage 5: Top-Level Project Rename, Delete, And Restore

Change `src-ui/app/project-flow.js`:

- In `submitProjectRename`:
  - `applyOptimistic`: `showProjectsStatus(render, "Renaming project...")`
  - `run`: add staged status in `commitProjectMutationStrict`
  - `onSuccess`: after mutation, show `Refreshing project list...` while invalidating query
  - after invalidation settles, clear project status and show notice `Project renamed.`
- In `deleteProject`:
  - start: `Deleting project...`
  - completion notice: `Project deleted.`
- In `restoreProject`:
  - start: `Restoring project...`
  - completion notice: `Project restored.`

Modify `commitProjectMutationStrict`:

- Accept optional `render` and `statusLabels`.
- Before metadata write:
  - `Updating project metadata...`
- Before Tauri repo operation:
  - rename: `Renaming project repo...`
  - delete: `Marking project repo deleted...`
  - restore: `Restoring project repo...`

## Stage 6: File Rename, Delete, Restore, And Glossary Link Changes

Change `src-ui/app/project-chapter-flow.js`:

- In `submitChapterRename`:
  - start status: `Renaming file...`
  - after local command success: `Syncing project repo...`
  - before `refreshProjectFilesFromDisk`: `Refreshing file list...`
  - final notice: `File renamed.`
- In `persistChapterGlossaryLinks`:
  - start: `Updating file glossary...`
  - sync: `Syncing project repo...`
  - refresh: `Refreshing file list...`
  - final notice: `Glossary updated.`
- In `submitCoordinatedChapterLifecycleMutation`:
  - replace `debugText` strings with user labels:
    - delete: `Deleting file...`
    - restore: `Restoring file...`
  - on success after repo sync/refresh:
    - `File deleted.`
    - `File restored.`

Change `scheduleProjectRepoSyncAfterLocalWrite`:

- Add optional labels:

```js
{
  syncText = "Syncing project repo...",
  refreshText = "Refreshing file list...",
  successNotice = ""
}
```

- Before `reconcileProjectRepoSyncStates`: show sync text.
- Before `refreshProjectFilesFromDisk`: show refresh text.
- After success: clear projects status, optionally show success notice.

## Stage 7: Permanent File Delete

Change `src-ui/app/project-chapter-flow.js`:

- In `permanentlyDeleteChapter` / `submitSimpleChapterMutation`, replace:
  - `Permanent delete clicked`
  - `Optimistic permanent delete applied`
  - `Background sync started`
- With:
  - `Deleting file permanently...`
  - `Syncing project repo...`
  - `Refreshing file list...`
- On completion:
  - clear projects status
  - show notice `File permanently deleted.`
- On failure:
  - clear projects status
  - show notice/error as today.

## Stage 8: File Import

Change `src-ui/app/project-import-flow.js`:

- Single file import:
  - replace `Adding file...` with `Importing file...`
  - before repo reconcile: `Syncing project repo...`
  - before file refresh: `Refreshing file list...`
  - success notice already exists; keep it.
- Batch import:
  - initial: `Importing files...`
  - inside loop:

```js
showProjectsStatus(render, `Importing ${index + 1} of ${files.length}...`);
```

  - before repo reconcile: `Syncing project repo...`
  - before file refresh: `Refreshing file list...`
  - final notice:
    - if partial failures: `Imported X files. Y files failed.`
    - if all succeeded: existing success notice is fine.

## Stage 9: Repair, Rebuild, And Conflict Overwrite

Change `src-ui/app/project-flow.js`:

- `repairProjectRepoBinding`:
  - before repair: `Repairing project repo binding...`
  - before reload: `Refreshing project list...`
  - success: `The project repo binding was repaired.`
- `rebuildProjectLocalRepo`:
  - replace notice with projects status:
    - `Rebuilding local project repo...`
    - then `Refreshing project list...`
  - after reload: clear status, show `Local project repo rebuilt.`
- `overwriteConflictedProjectRepos`:
  - before invoke: `Overwriting conflicted project repos...`
  - before reload: `Refreshing project list...`
  - success notice already exists; keep it.
  - clear projects status on success/error.

## Stage 10: Repo Sync Ownership

Change `src-ui/app/project-repo-sync-flow.js`:

- Keep current repo sync messages:
  - `Checking local repos...`
  - `Cloning N repos...`
  - `Syncing N repos...`
- Add option:

```js
clearStatusOnComplete: true
```

- For nested operations, callers can pass `clearStatusOnComplete: false` so they can show the next stage, such as `Refreshing file list...`.
- Default remains current behavior.

## Stage 11: Tests

Add or update tests:

- `status-feedback.test.js`
  - notice only
  - scoped sync only
  - notice + scoped sync both returned
  - clearing notice does not clear scoped sync
  - clearing scoped sync does not clear notice
- `projects.test.js`
  - status surface renders both sync and notice lines.
- `project-flow.test.js`
  - project creation shows creation and refresh stages.
  - project rename/delete/restore show start and completion statuses.
  - permanent project delete shows multi-stage labels.
- `project-chapter-flow.test.js`
  - file rename shows save -> sync -> refresh -> notice.
  - file delete/restore show useful labels, not debug strings.
- `project-import-flow.test.js`
  - single import shows import -> sync -> refresh.
  - batch import shows `Importing X of Y`.

## Stage 12: Cleanup

After tests pass:

- Remove or stop exporting `setProjectUiDebug` if no longer needed.
- Remove debug copy:
  - `Delete clicked`
  - `Restore clicked`
  - `Permanent delete clicked`
  - `Optimistic permanent delete applied`
  - `Background sync started`
- Ensure `clearNoticeBadge` is not used to clear long-running project progress.
- Ensure all project long-running operations end with either:
  - clear scoped status + success notice, or
  - clear scoped status + error notice/modal error.
