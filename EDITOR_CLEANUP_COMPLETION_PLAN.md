# Editor Cleanup Completion Plan

## Goal

The goal is not to keep refactoring indefinitely.

The goal is:

`editor is stable, test-backed, understandable, and no longer has concentrated bug-risk files`

Cleanup work stops when the steps below are complete. After that, editor work should be limited to:

- user-requested features
- specific bug fixes
- small local cleanups required by those changes

## Step 1: Cleanup The Cleanup

Purpose:

- remove dead imports/exports
- remove duplicated helper seams introduced by the split
- keep one source of truth for shared selectors/helpers

Completion criteria:

- dead imports and dead exports removed
- duplicated helper logic consolidated to one module
- no newly added helper module exists only as a partial duplicate of another module
- `npm test` passes
- `npm run build` passes
- `npm run test:browser` passes

Known examples already identified:

- unused `compactDirtyRowIds` import in `src-ui/app/editor-persistence-flow.js`
- duplicated project selectors between `src-ui/app/project-context.js` and `src-ui/app/project-chapter-flow.js`

## Step 2: Finish Splitting Structural Row Operations

Target file:

- `src-ui/app/editor-row-structure-flow.js`

Purpose:

- separate pure row-state transitions from backend/UI orchestration
- reduce risk in insert/delete/restore/permanent-delete behavior

Completion criteria:

- pure row lifecycle transitions extracted into testable helpers
- backend operations are thin wrappers around those transitions
- insert, soft-delete, restore, and permanent-delete paths have direct unit coverage
- browser regressions cover known scroll-jump and deleted-section open/closed behavior
- no mixed function remains that both computes row state and performs backend work unless there is a clear reason

## Step 3: Finish Splitting Persistence And History Operations

Target files:

- `src-ui/app/editor-persistence-flow.js`
- `src-ui/app/editor-history-flow.js`

Purpose:

- make save-state and history-state behavior easier to reason about
- reduce risk around dirty rows, blur-save, restore, and undo replace

Completion criteria:

- dirty-row tracking is pure and testable
- save-state transitions are pure and testable
- history-state transitions are pure and testable
- backend `invoke` paths are thin wrappers around those transitions
- restore, undo replace, blur-save, and focus-switch flows have regression coverage
- there is no known repro where edits can disappear from history because app-driven UI transitions skipped the save path

## Step 4: Virtualization Hardening And Freeze

Target file:

- `src-ui/app/editor-virtualization.js`

Purpose:

- keep virtualization isolated to virtualization concerns
- eliminate known blank-screen and scroll-anchor regressions

Completion criteria:

- virtualization owns virtualization behavior only, not unrelated editor state
- anchor restore and layout invalidation behavior are covered by tests or replayable harness cases
- no known repro remains for:
  - first delete after open causing a large jump
  - fast scroll after structural edits producing a blank screen
  - replace/select/history actions causing position loss

## Exit Condition

The cleanup phase is complete when:

1. Step 1 is complete
2. Step 2 is complete
3. Step 3 is complete
4. Step 4 is complete
5. the editor passes:
   - `npm test`
   - `npm run build`
   - `npm run test:browser`

At that point, cleanup work stops by default.

## Expected Scope

Estimated remaining cleanup scope:

- roughly 4 to 6 commits

After that, editor work should be feature-driven or bug-driven, not cleanup-driven.
