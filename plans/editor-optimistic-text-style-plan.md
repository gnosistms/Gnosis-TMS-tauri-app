# Editor Optimistic Text Style Plan

## Goal
Make row text style controls optimistic and non-blocking. Users should be able to switch style rapidly while saves/commits are pending, and the latest selected style should win.

This phase assumes row text and marker commits are already queue-owned and that all project repo writes use the shared `repoWriteQueue`. The selected rollout is full overlap support: text style controls should remain interactive even while row text or marker saves are queued or running.

## Current Problem
Text style controls are blocked in two places:
- Style buttons render `disabled` while `textStyleSaveState.status === "saving"`.
- `setEditorRowTextStyle` refuses to run while row text, marker, style, or comment writes are pending.

## Files To Touch
- `src-ui/app/editor-persistence-flow.js`
- `src-ui/app/editor-persistence-state.js`
- `src-ui/app/editor-row-render.js`
- `src-ui/app/editor-row-text-style.js`
- `src-ui/app/editor-write-guards.test.js`
- `src-ui/app/editor-persistence-state.test.js`
- `src-ui/screens/translate-source.test.js` or a render-focused test for disabled style buttons.

## Behavior
On style click:
1. Normalize requested style.
2. If requested style equals current displayed style, do nothing.
3. Apply `row.textStyle` immediately.
4. Mark text style as pending visually, without disabling buttons.
5. Enqueue/coalesce operation by:
   - `textStyle:${chapterId}:${rowId}`
6. Let older running operations complete but ignore stale success/failure if a newer style intent exists.

## Operation Payload
The queued style operation captures:
- `rowId`
- `nextTextStyle`
- `previousTextStyle`
- `intentVersion`
- `repoScope`
- `chapterScope`
- `rowScope`
- `coalesceKey`

## Optimistic State Shape
Current `textStyleSaveState` can be extended:
- `status`: `idle` or `saving`
- `intentVersion`
- `textStyle`
- `error`

If later per-language style exists, this should become keyed, but current style appears row-level.

## Success Handling
On success:
- Ignore stale payloads.
- If latest:
  - update `textStyle`,
  - update persisted/confirmed style state if separate,
  - update `lastUpdate`,
  - update `chapterBaseCommitSha`,
  - clear pending style status.

## Failure Handling
On failure:
- Ignore stale failure for rollback purposes.
- If latest:
  - restore `previousTextStyle`, or retain selected style with error.
  - Preferred first implementation: rollback to previous style and show a lower-right badge.

## Removed Blocks
Remove or relax:
- style button `disabled` while style save is pending,
- early return on `row.textStyleSaveState?.status === "saving"` for repeated style choices,
- blocking style change only because row text save is queued or running,
- blocking style change only because marker save is queued or running,
- blocking style change only because comments are saving after comments are queue-owned.

Keep:
- permission/read-only checks,
- soft-deleted checks,
- conflict/remotely deleted checks,
- no-op when requested style equals current displayed style,
- current write permission assertion immediately before the queued operation invokes the Tauri command.

## Interaction With Review Diff
Text style changes count as current text for review diff display. Optimistic style state should therefore update the Review tab immediately through the existing sidebar-only live diff path when the active row/language is affected.

## Tests
Add tests for:
- style buttons do not render `disabled` while style save is pending.
- rapid style changes coalesce to latest style.
- stale success does not overwrite newer style.
- stale failure does not rollback newer style.
- latest failure rolls back or stores style error according to chosen policy.
- style change while row text save is pending remains clickable.
- Review tab treats optimistic style change as current text.
- Style command re-checks current write permission at run time and does not invoke Tauri if the user became a viewer while queued.
- Final persisted command payload/repo state matches the latest style intent, not just the UI state.

## Acceptance Criteria
- Users can change row style repeatedly without waiting.
- Latest selected style wins.
- No style control is disabled solely due to pending style save.
- No style operation can run concurrently with another commit-producing operation for the same repo.
- Style controls remain interactive while row text and marker saves are queued or running.
- `npm test` passes.
