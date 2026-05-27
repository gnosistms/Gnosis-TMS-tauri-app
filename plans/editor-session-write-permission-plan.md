# Editor Session Write Permission Plan

## Summary
Make editor write-permission checks fast and stable by taking a permission snapshot when an editor file opens, using that snapshot for editor UI state, and enforcing current permissions only at the write/commit boundary. This avoids constantly disabling editor controls during normal editing while still blocking commits if a user was changed from Translator/Admin/Owner to Viewer while the editor was open.

## Problem
The May 19 viewer/write-access work made editor controls more sensitive to live team permission state. Current editor rendering calls `canMutateProjectFiles(selectedProjectsTeam())` directly in places like `src-ui/screens/translate.js`, and row capabilities are derived from `getProjectWritePolicy({ team: selectedProjectsTeam(), ... })` in `src-ui/app/editor-screen-model.js`.

That is correct for strict read-only enforcement, but it is too reactive for the editor. Team membership does not usually change while someone is actively editing a file, and re-checking live team permissions during render can make buttons disappear or disable at inconvenient times. The editor should prioritize stable, fast editing and enforce the final permission decision when saving/committing.

## Desired Behavior
- When a translator opens a chapter, editor controls remain available for that editor session.
- If team data refreshes while the editor is open, routine membership changes do not immediately churn the editor UI.
- If the user has been changed to Viewer while the editor was open, the next write/commit attempt is blocked.
- The block is visible and actionable:
  - lower-right badge: `Cannot save changes: your account is now Viewer.`
  - row save state stops showing endless `Saving...`
  - further editor commits are locked until the user refreshes/reopens the file or team permissions are restored.
- Soft-deleted teams, projects, chapters, and rows remain read-only. This is resource lifecycle state, not just account role state, and must continue to be enforced in the editor UI.

## Architecture

### 0. Add A Shared Editor Permission Module
Add a focused helper module, preferably `src-ui/app/editor-write-permission.js`, so editor role checks do not stay scattered across render code and write flows.

Required helpers:

```js
captureEditorWritePermissionSnapshot({ team, project, chapter })
editorSessionCanWrite(editorChapter)
getEditorLifecycleWritePolicy({ project, chapter, row, actionKind })
assertCurrentEditorWritePermission({ actionKind, rowId })
handleEditorPermissionDenied(error, render)
invokeEditorWriteCommand(command, payload, { render, actionKind, rowId })
```

Responsibilities:
- snapshot account-role permission when the editor opens,
- derive stable editor UI capability from the snapshot,
- keep soft-delete/lifecycle checks live,
- perform current role/lifecycle validation immediately before writes,
- normalize permission-denied failures from local checks and Tauri/broker writes,
- set the editor write lock and badge the user when permission is denied.

Every editor mutation should either call `assertCurrentEditorWritePermission` before entering a `saving` state or use `invokeEditorWriteCommand`, which performs the check and handles permission errors.

### 1. Add An Editor Permission Snapshot
Add a snapshot object to editor state, probably under `state.editorChapter.writePermissionSnapshot`.

Suggested shape:

```js
{
  teamId,
  installationId,
  projectId,
  chapterId,
  membershipRole,
  canEditProjectFiles,
  canUseAssistant,
  canUseReviewActions,
  capturedAt,
  source: "open-chapter"
}
```

Create a helper such as:

```js
captureEditorWritePermissionSnapshot({ team, project, chapter })
```

Rules:
- `canEditProjectFiles` is based on the current team role/capabilities at the moment the chapter opens.
- Snapshot should be replaced when:
  - a different chapter opens,
  - a different team/project opens,
  - the user explicitly refreshes permissions or reopens the editor from the project screen,
  - a permission-lock recovery action succeeds.
- Snapshot should not be replaced by background team refresh while the same chapter remains open.
- Snapshot should not be replaced by editor data refreshes that preserve visible rows, such as background sync or row reloads.
- If `loadSelectedChapterEditorData` runs with a `preserveVisibleRows`/refresh-style path, preserve the existing snapshot unless the caller explicitly asks to refresh permissions.
- Initial load should capture the snapshot before the first editor render that exposes write controls.

### 2. Use The Snapshot For Editor UI
Replace render-time role checks in editor UI with the snapshot.

Targets:
- `src-ui/screens/translate.js`
  - `renderTranslateHeaderDetail`
  - `renderTranslateSidebar`
  - any other `writeActionsAvailable` derivation
- `src-ui/app/editor-screen-model.js`
  - row `canEdit`, `canInsert`, `canSoftDelete`, `canReplaceSelect`
- sidebar tab availability:
  - AI Assistant
  - Review
  - Comments write controls

Important distinction:
- Use the snapshot for account-role capability.
- Still apply live resource lifecycle checks for soft-deleted objects.

Example:

```js
const sessionCanWrite = editorWritePermissionSnapshotAllowsWrite(state.editorChapter);
const lifecyclePolicy = getProjectLifecycleWritePolicy({ project, chapter, row });
const canEditRows = sessionCanWrite && lifecyclePolicy.allowed;
```

Split or wrap `getProjectWritePolicy` so the editor can separately evaluate:
- role/account checks, and
- resource lifecycle checks.

Suggested required helpers:

```js
getProjectRoleWritePolicy({ team, actionKind })
getProjectLifecycleWritePolicy({ team, project, chapter, row, actionKind })
```

Editor render paths should not use live role/team permission directly. They should use:

```js
editorSessionCanWrite(state.editorChapter)
  && getProjectLifecycleWritePolicy({ project, chapter, row, actionKind }).allowed
  && !editorWriteLockIsActive(state.editorChapter)
```

Avoid continuing to call `canMutateProjectFiles(selectedProjectsTeam())` directly from editor render paths.

### 3. Keep A Central Commit-Time Permission Gate
Before any operation that writes to local repo files or commits/pushes, run a current permission check.

Targets include:
- editor row save/persist path,
- row insert/delete/restore operations,
- chapter language changes,
- clear translations,
- AI translate/review writebacks,
- batch replace,
- style/comment/review marker saves if they commit or mutate row files.

The gate should use current team/member state, not the stale snapshot. Prefer a single helper such as:

```js
assertCurrentEditorWritePermission({ team, project, chapter, row, actionKind })
```

If local cached team role says the user is now Viewer, fail before invoking Tauri.

If local state still says writeable but Tauri/broker/GitHub rejects the write as read-only, normalize that error into the same permission-lock flow.

Authoritative enforcement options:
- Preferred: make the Tauri/broker repo mutation commands verify current app role before committing/pushing, and return a consistent permission-denied error.
- Acceptable first step: perform a lightweight current-membership check in `assertCurrentEditorWritePermission` before write commands that can commit/push.
- Do not rely only on the editor snapshot or stale local team cache for final enforcement.

Every editor write path must be covered, including:
- `save_gtms_editor_row`
- `update_gtms_editor_row_text_style`
- `update_gtms_editor_row_field_flag`
- comment save/delete commands
- image URL/upload/remove commands
- row insert/delete/restore commands
- language add/remove/reorder/persist commands
- clear translations
- unreview all
- AI translate/review writeback
- batch replace and replace undo/history restore flows

Implementation preference:
- Wrap Tauri writes in `invokeEditorWriteCommand`.
- For flows that need to do local state changes before invoking Tauri, call `assertCurrentEditorWritePermission` before setting any row/comment/style state to `saving`.

### 4. Add An Editor Write Lock
Add state such as:

```js
state.editorChapter.writeLock = {
  status: "locked",
  reason: "roleChangedToViewer",
  message: "Cannot save changes: your account is now Viewer.",
  lockedAt,
}
```

When locked:
- prevent new editor write attempts,
- show a lower-right badge immediately,
- show persistent row/editor status where appropriate,
- reset active `saving` rows to a blocked/error state instead of leaving them spinning,
- keep read-only browsing/download behavior available,
- offer recovery through refresh/reopen rather than silent retry loops.
- override the editor session snapshot in render/model paths so write controls become consistently unavailable after the lock is set.

The lock should not be used for transient network failures. It is only for confirmed permission denial/read-only role state.

Suggested helpers:

```js
editorWriteLockIsActive(editorChapter)
setEditorPermissionWriteLock({ message, reason })
clearEditorPermissionWriteLock()
applyEditorPermissionLockToPendingRows(editorChapter, message)
```

`applyEditorPermissionLockToPendingRows` should convert rows in `saving` or queued dirty-save states into a clear blocked/error state with the permission message. It should also settle marker/style/comment save states where the failed operation is permission-related.

### 5. Normalize Permission Errors
Add a small classifier for write failures:

```js
isEditorPermissionDeniedError(error)
```

It should recognize:
- broker/Tauri errors that say Viewer/read-only/cannot mutate project files,
- GitHub 403/404 style permission denial where the broker maps it clearly,
- local `getProjectWritePolicy(...).reason === "viewer"` failures.

When classified:
- set the editor write lock,
- badge the user,
- clear/settle pending save indicators.

The normalized error should preserve the user-facing message:

```js
Cannot save changes: your account is now Viewer.
```

Use this same message for:
- local current-role check failures,
- broker/Tauri permission-denied failures,
- final commit/push permission-denied failures.

### 6. Preserve Soft-Delete Enforcement
Soft-deleted state must continue to disable editing even if the session permission snapshot says the user can write.

Do not snapshot these as permanent write grants:
- team soft-deleted,
- project soft-deleted,
- chapter soft-deleted,
- row soft-deleted.

These should remain part of current editor model derivation because they are resource state, not user role state.

## Implementation Steps
1. Add editor permission snapshot fields and helpers.
2. Capture the snapshot when loading/opening an editor chapter.
3. Update editor render/model code to use the snapshot for role-based write availability.
4. Split or wrap write policy helpers so lifecycle read-only checks remain live.
5. Add centralized current-permission enforcement before editor writes.
6. Add editor write-lock state and badge/status handling.
7. Normalize permission-denied errors from local checks and Tauri failures into the write lock.
8. Replace direct editor Tauri write invocations with `invokeEditorWriteCommand` or an explicit `assertCurrentEditorWritePermission` call.
9. Add tests around stable UI, commit-time denial, and lock behavior.

## Tests

### Unit Tests
- Opening a chapter captures the current role/capability snapshot.
- Background team role refresh does not change editor `writeActionsAvailable` for the open chapter.
- Reopening or switching chapters refreshes the snapshot.
- Soft-deleted project/chapter/row still disables editing even when the snapshot allows writing.
- A Viewer snapshot renders the editor read-only from the start.
- A Translator snapshot keeps controls enabled even if live team role later changes to Viewer.
- Commit/write gate blocks when live role is Viewer.
- Permission-denied Tauri errors set the editor write lock.
- Write lock clears pending save indicators and prevents repeated save attempts.
- Lower-right badge is shown for the permission lock.
- `invokeEditorWriteCommand` performs current permission validation before invoking Tauri.
- Each major editor write flow either uses `invokeEditorWriteCommand` or explicitly calls `assertCurrentEditorWritePermission`.
- Locked editor state overrides a previously writeable session snapshot.

### Regression Tests
- Review live diff sidebar updates still do not re-render the editor body.
- Viewer users who open a file as Viewer still cannot edit.
- Translators can still save, insert rows, update comments/markers/styles, and use AI writeback flows.
- Soft-deleted resources remain read-only for all roles.
- Background team refresh does not hide editor write controls for an already-open Translator session.
- A local role change to Viewer blocks the next save and locks the editor.
- A Tauri/broker permission-denied write failure blocks the next save and locks the editor even if local team cache still says Translator.

## Files Likely To Change
- `src-ui/app/state.js`
- `src-ui/app/resource-write-policy.js`
- `src-ui/app/resource-capabilities.js`
- `src-ui/app/editor-write-permission.js`
- `src-ui/app/editor-chapter-load-flow.js`
- `src-ui/app/editor-screen-model.js`
- `src-ui/app/editor-persistence-flow.js`
- `src-ui/app/editor-row-structure-flow.js`
- `src-ui/app/editor-row-sync-flow.js`
- `src-ui/app/editor-comments-flow.js`
- `src-ui/app/editor-image-flow.js`
- `src-ui/app/editor-ai-translate-all-flow.js`
- `src-ui/app/editor-ai-review-flow.js`
- `src-ui/app/editor-ai-review-all-flow.js`
- `src-ui/app/editor-history-flow.js`
- `src-ui/app/actions/translate-actions.js`
- `src-ui/screens/translate.js`
- `src-ui/screens/translate-sidebar.js`
- related editor tests

## Open Design Notes
- The snapshot should only relax account-role churn inside an already-open editor. It should not grant write access across app restarts or newly opened files.
- The final enforcement point should be as close to the actual write/commit as practical so every write path benefits from the same protection.
- The badge/error copy should distinguish role changes from network or conflict errors.
- We should avoid a new background permission polling system unless there is a clear product need. The goal is stable editor UI and commit-time enforcement, not continuous surveillance of membership state.
