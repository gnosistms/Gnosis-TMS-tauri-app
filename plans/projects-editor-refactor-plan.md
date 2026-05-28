# Projects And Editor Refactor Plan

## Summary

Split the projects page into smaller focused modules first, then make targeted editor splits only where files mix unrelated responsibilities. This should be a low-risk extraction refactor with no intentional behavior changes.

## Principles

- Do pure extraction first: move code, keep behavior identical.
- Keep policy centralized: viewer permissions, soft-delete read-only rules, queued writes, lifecycle guards, and lifecycle normalization should not be copied into render files.
- Add or keep regression tests around existing behavior before and after each split.
- Avoid splitting files only because they are long if they already have a clear single responsibility.
- Keep commits small enough to review: one commit for projects rendering extraction, one for project flow extraction, and one for targeted editor extraction.

## Phase 1: Projects Page Split

Target files:

- `src-ui/screens/projects.js`
- `src-ui/app/project-flow.js`
- `src-ui/app/project-chapter-flow.js`

### New Screen Modules

Create `src-ui/screens/project-list-render.js` for:

- Project card/list rendering.
- Top-level project action buttons.
- Empty, loading, active, and deleted project states.

Create `src-ui/screens/project-chapter-list-render.js` for:

- Chapter/file rows.
- Chapter title/open affordance.
- Per-file action buttons.
- Per-file status labels and pending state rendering.

Create `src-ui/screens/project-glossary-selector.js` for:

- Glossary selector rendering.
- Disabled-state label behavior.
- Assigned glossary fallback labels.
- Selector option rendering and selected-value normalization.

Create `src-ui/screens/project-deleted-section.js` for:

- Deleted files section.
- Local hard-delete controls.
- Clear deleted files UI.
- Deleted section expanded/collapsed presentation.

### New App Modules

Create `src-ui/app/project-lifecycle-flow.js` for:

- Rename project.
- Soft-delete project.
- Restore project.
- Local hard-delete project.
- Project lifecycle confirmation modal coordination.

Create `src-ui/app/project-chapter-lifecycle-flow.js` for:

- Rename chapter.
- Soft-delete chapter.
- Restore chapter.
- Local hard-delete chapter/file.
- Chapter lifecycle confirmation modal coordination.

Create `src-ui/app/project-glossary-flow.js` for:

- Assign/unassign glossary.
- Selector option state.
- Metadata refresh behavior after assignment.
- Rollback/error behavior for failed glossary assignment.

Create `src-ui/app/project-page-write-state.js` for:

- Helpers that decide which project/page controls are blocked.
- Queue-aware pending state helpers.
- Shared UI state labels for writes/syncs.
- Project and chapter pending mutation matching.

### Shared Policy Modules

Do not duplicate checks that already belong in shared policy modules. Keep using or improve the existing centralized helpers for:

- Resource write policy.
- Project write coordinator / repo write queue helpers.
- Viewer permission helpers.
- Soft-delete and lifecycle normalization helpers.
- Read-only child-resource behavior for soft-deleted parents.

## Phase 2: Projects Tests

Before or during extraction, preserve explicit tests for:

- Deleted project glossary selector stays disabled but preserves assigned label.
- Disabled project glossary selector shows the assigned glossary even when the glossary is not currently selectable.
- Project refresh does not unnecessarily disable safe actions.
- `+ New Project` is blocked during mutating project writes.
- Local hard-delete is available offline.
- Local hard-delete is blocked only for the matching pending lifecycle mutation.
- Viewer can download but cannot mutate.
- Soft-deleted project children render read-only.
- Deleted files section keeps clear-all controls in the intended position.

Run targeted project tests while iterating, then run full `npm test`.

## Phase 3: Editor Targeted Splits

Only do this after the projects split is stable.

### `editor-persistence-flow.js`

Candidate extractions:

- Move queue submission helpers into `src-ui/app/editor-save-queue-flow.js`.
- Move commit/result handling into `src-ui/app/editor-commit-flow.js`.
- Keep the public save API stable so existing input handlers do not need broad rewiring.

### `editor-row-render.js`

Candidate extractions:

- Move marker buttons into `src-ui/app/editor-row-marker-render.js`.
- Move text style controls into `src-ui/app/editor-row-style-render.js`.
- Keep row layout assembly in `editor-row-render.js`.

### `translate-sidebar.js`

Candidate extractions:

- Move review tab rendering into `src-ui/screens/translate-review-pane.js`.
- Move assistant tab rendering into `src-ui/screens/translate-assistant-pane.js`.
- Keep sidebar shell/tab routing in `translate-sidebar.js`.

### `editor-image-flow.js`

Candidate extractions:

- Move image persistence actions into `src-ui/app/editor-image-persistence-flow.js`.
- Move image modal/selection coordination into `src-ui/app/editor-image-selection-flow.js`.

## Phase 4: Safety Checks

After each phase:

- Run `npm test`.
- Run `git diff --check`.
- Avoid behavior edits unless a test exposes an existing bug.
- Review imports for circular dependencies.
- Verify no shared policy check was copied into multiple render modules.

## Recommended Implementation Order

1. Split project render modules.
2. Split project lifecycle/glossary flow modules.
3. Run and adjust project tests.
4. Stop and review the projects page refactor.
5. Split targeted editor files only after the projects refactor is stable.

