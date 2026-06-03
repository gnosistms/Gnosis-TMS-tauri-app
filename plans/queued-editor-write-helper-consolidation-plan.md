# Queued Editor Write Helper Consolidation Plan

## Problem

`editor-persistence-flow.js` defines a private `invokeQueuedEditorWriteCommand` helper even though `editor-queued-write.js` already exports a shared helper with the same responsibility.

That split is a bad design because queued editor write behavior is cross-cutting. Row text, marker, style, clear-translation, and related persistence operations can drift away from other editor flows if they use a private helper. It also makes debugging save failures unreliable: changing or instrumenting the shared helper does not necessarily affect row persistence saves.

## Goal

All queued editor write Tauri invocations should go through one shared helper in `editor-queued-write.js`.

`editor-persistence-flow.js` should keep persistence-specific behavior only:

- optimistic row and history state
- dirty-row tracking
- rebase logic
- conflict handling
- success and failure reconciliation

The shared helper should own:

- resolving the queued team context
- editor write permission checks
- invoking Tauri commands
- permission-denied UI handling
- no local-save timeout

## Implementation Steps

1. Remove the private `invokeQueuedEditorWriteCommand` function from `src-ui/app/editor-persistence-flow.js`.

2. Import the shared helper from `src-ui/app/editor-queued-write.js`:

   ```js
   import {
     assertQueuedEditorRowsReady,
     invokeQueuedEditorWriteCommand,
   } from "./editor-queued-write.js";
   ```

3. Remove now-unused imports from `editor-persistence-flow.js` if they were only needed by the private helper:

   - `selectedProjectsTeam`
   - `assertEditorWritePermissionForContext`
   - `handleEditorPermissionDenied`
   - `invoke`

4. Compare the private helper with the shared helper before deletion. If the private helper has any behavior that the shared helper lacks, move that behavior into `editor-queued-write.js` first.

5. Keep all existing call sites in `editor-persistence-flow.js` using the same helper name so the change is limited to import wiring and duplicate removal.

6. Add a source-level regression test that fails if `editor-persistence-flow.js` defines its own `invokeQueuedEditorWriteCommand` again.

7. Run focused tests:

   ```sh
   node --test src-ui/app/editor-write-guards.test.js
   node --test src-ui/app/editor-history.test.js src-ui/app/editor-history-state.test.js
   node --test src-ui/app/editor-operation-queue.test.js src-ui/app/repo-write-queue.test.js
   node --test --loader ./src-ui/test/raw-loader.mjs src-ui/screens/translate-sidebar.test.js
   ```

8. Run syntax checks for touched files:

   ```sh
   node --check src-ui/app/editor-persistence-flow.js
   node --check src-ui/app/editor-queued-write.js
   ```

## Verification Criteria

- `editor-persistence-flow.js` no longer defines a private `invokeQueuedEditorWriteCommand`.
- Row text saves, marker saves, style saves, clear translations, and unreview-all still enqueue and reconcile correctly.
- Existing permission-denied behavior is unchanged.
- Optimistic local save UI still renders as `Pending local save`, `Not saved yet`, and `Local save stalled` when overdue.
- The codebase has one shared place to instrument or modify queued editor write invocation behavior.

## Follow-Up

After this consolidation, debug the actual local-save stall from the single shared invocation path. If a row text save stalls, the next likely area is the Rust-side Tauri command and local repo write/commit path, not divergent JavaScript queue plumbing.
