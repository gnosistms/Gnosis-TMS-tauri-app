# Local Editor Save Queue Plan

## Problem

Editor changes are currently able to appear as `Saving...` in the UI without becoming durable local Git commits. In at least one observed case, an edit was visible in the editor, the local project repo remained clean, and the edit disappeared after restarting the app.

The expected durability model is:

- Editor changes become durable when committed to the local project repo.
- Remote GitHub/broker sync is separate from local durability.
- Broker or GitHub failures must not prevent local saves.
- All Git-mutating operations still need one serialization point per project repo so the worktree is not corrupted.

This plan is scoped to a single running app instance. Multiple simultaneous app instances may still need additional cross-process locking or conflict handling later, but that is not part of this immediate fix.

## Current Risk

The app currently uses the same repo write queue for local editor writes and background sync work. That is not automatically wrong, because both can mutate the same Git worktree. The problem is that the queue does not clearly distinguish local durability from remote sync, and remote sync can delay or obscure local save progress.

This creates several bad states:

- A row can show `Saving...` while no local commit has happened.
- A background sync failure can look like a local save problem.
- Refresh can rely too much on remote sync results instead of reloading local repo state.
- Restarting or closing the app can lose queued edits if local writes have not completed.

## Implementation Plan

### 1. Define the local durability contract

Document and enforce these invariants:

- Every editor mutation must enqueue a local repo write.
- A local editor write is successful only after the row data is written and committed locally.
- Remote sync is never required for a local save to succeed.
- Remote sync status must be shown separately from local save status.
- One in-process repo coordinator serializes Git-mutating operations per project repo.

Editor mutations include blur saves, Shift+Enter saves, restore actions, AI translate actions, review actions, language clearing, and any other operation that changes editor state.

### 2. Refactor the repo write queue into a repo coordinator

Replace the generic shared queue semantics with explicit operation types:

- `localEditorWrite`
- `localMetadataWrite`
- `remoteSync`
- `repoMaintenance`

The coordinator should still run only one Git-mutating operation at a time for a given project repo, but scheduling should be policy-driven:

- Local writes run before remote sync.
- Remote sync starts only when no local writes are pending and no editor rows are dirty in memory.
- A pending remote sync is deferred when new local writes arrive.
- The active operation and pending operation counts are observable by the UI.

This keeps Git access safe while making local save durability the priority.

### 3. Make editor saves commit locally through the queue

Ensure every editor mutation path routes through the local editor write operation. Individual actions should not bypass the queue or implement special save behavior.

Each successful `localEditorWrite` should return enough information for the UI to update durable state:

- changed row ids
- local commit hash
- commit timestamp
- operation id
- any updated history payload needed by the editor

Failures should be reported as local save failures, not background sync failures.

### 4. Separate remote sync scheduling from local save status

Background sync should become a client of the repo coordinator, not part of the editor save lifecycle.

Remote sync should publish its own status:

- `paused`
- `waiting`
- `syncing`
- `failed`
- `complete`

Remote sync may still need the same repo coordinator lock because it mutates the worktree, but it must not mark editor rows as saved, unsaved, or failed. It can trigger local reloads or invalidations after it completes.

### 5. Improve editor save UI state

Replace ambiguous local save status with explicit states:

- `Unsaved changes`
- `Queued`
- `Saving locally`
- `Saved locally`
- `Local save failed`

Keep remote sync messaging separate:

- `GitHub sync paused`
- `Waiting to sync`
- `Syncing GitHub`
- `GitHub sync failed`

The Review/History panel should not show `Last update - Saving...` as if it were committed history. If an optimistic history entry is visible before the local commit lands, label it as pending local save.

### 6. Protect close, quit, and navigation

Add guards for:

- browser unload
- Tauri window close
- app quit
- navigating away from the editor or project

If local editor writes are dirty, queued, or running, the app should flush pending local saves or block close/navigation. Pending remote sync should not block close unless it is actively mutating the repo. A warning may allow the user to leave only if it explicitly means discarding unsaved local edits.

### 7. Fix manual refresh semantics

Manual refresh should perform two separate actions:

1. Reload local project state from disk.
2. Optionally trigger remote sync if available.

Broker or GitHub failure must not prevent local reload. This keeps manual refresh useful as a local disk refresh even when remote sync is paused or unavailable.

If the optional remote sync later changes local files, the editor should receive a second reload or invalidation after sync completes.

### 8. Add regression coverage

Add tests for the failure modes directly:

- Editor save creates a local commit.
- After `Saved locally`, `git log` contains the local commit and the committed row file contains the edit.
- Editor save still commits when broker or GitHub auth is unavailable.
- Pending remote sync does not starve a local editor save.
- Remote sync waits for local writes to drain.
- Remote sync waits while editor rows are dirty in memory but not yet enqueued.
- App close or navigation is blocked or warned while local save is pending.
- Manual refresh reloads committed local changes from disk.
- Optimistic `Saving...` state clears on local save success or failure.

### 9. Defer separate local-edit branches

Do not introduce a dedicated local-edits branch yet.

A separate branch could help future offline-first conflict handling, but it adds checkout, merge, and multi-instance complexity. The immediate data-loss bug can be fixed by committing editor changes promptly to the current local project branch and making remote sync subordinate to local durability.

## Success Criteria

- An editor edit that reports `Saved locally` survives app restart.
- An editor edit that reports `Saved locally` exists in the local Git history and in the committed row file.
- Local saves succeed without GitHub or broker connectivity.
- Remote sync cannot leave local saves indefinitely hidden behind `Saving...`.
- Manual refresh reloads local committed state even when remote sync is paused or failed.
- UI clearly distinguishes local save state from remote sync state.
