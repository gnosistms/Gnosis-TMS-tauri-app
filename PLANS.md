# PLANS.md

## project
Refactor editor virtualization just enough to support safe automatic refresh of stale row content without harming scroll smoothness or layout stability.

## objective
Replace the current stale-badge-only behavior for safe row updates with targeted row-level refreshes that:
- update only changed existing rows
- patch only visible rows in the DOM
- keep virtualization layout and spacer math correct
- avoid full editor body rerenders for ordinary background updates

## constraints
- Smooth scrolling is the highest priority.
- Do not rewrite the virtualization system from scratch.
- Do not introduce full translate-body rerenders as the normal path for row-level background updates.
- Do not auto-overwrite focused, dirty, staleDirty, or conflict rows.
- Do not auto-handle inserted or reordered rows in the first implementation.
- Any visible row patch must go through virtualization reconciliation for height correctness.

## non-goals
- Full redesign of the editor architecture
- Structural live insertion/reordering of rows during background sync
- Replacement of the current conflict-handling model
- Large UI redesigns or unrelated cleanup
- Redesign of remote sync cadence/policy (for example, true push/pull every 5 minutes)

## current problem
Background sync detects remote changes but currently marks rows stale instead of applying safe row updates directly. This avoids layout bugs but leaves the user with manual refresh behavior. A naive implementation that rerenders the whole editor body every few seconds would likely create scroll jank and risk height-cache errors.

This plan assumes a sync result is already available. The policy for when remote sync runs is a separate concern and can be changed later without changing the row-patch design.

## target design
Introduce a narrow virtualization seam that supports row-level patching safely.

Desired flow for safe changed rows:
1. Background sync detects changed existing rows.
2. Filter to rows that are safe to auto-refresh.
3. Update row state.
4. If a row is visible, patch only that row card in the DOM.
5. Notify virtualization that those rows changed.
6. Remeasure affected visible rows.
7. Reconcile height cache and spacer math in one animation frame.
8. Leave structural changes and unsafe rows on the existing stale/conflict path.

## milestones

### M1: expose a small virtualization API
Goal:
Create a clean public API for row-level layout invalidation and change notification without changing user-visible behavior.

Deliverables:
- public virtualization function(s), for example:
  - `notifyEditorRowsChanged(rowIds, options)`
  - `notifyEditorRowHeightMayHaveChanged(rowId, source)`
- internal path that remeasures affected visible rows and schedules one reconcile frame
- no stale-row auto-refresh yet

Success criteria:
- existing behavior unchanged
- explicit row-level entrypoint exists
- visible row height changes can be reconciled without full-body rerender

### M2: unify row rendering path for full render and row patch
Goal:
Ensure visible-row patching reuses the normal row renderer rather than inventing a second HTML path.

Deliverables:
- one row render path used both for visible-range rendering and row replacement
- row-level post-render hook for autosize, measurement, and focus-safe handling

Success criteria:
- row patch path matches normal row markup
- patched rows can be measured reliably
- no new duplicated rendering logic

### M3: implement safe visible-row patching
Goal:
Allow targeted patching of visible rows without changing structural list behavior.

Deliverables:
- given updated row state, patch only mounted visible row cards
- if a changed row is offscreen, update state only
- remeasure patched rows
- reconcile virtualization in one frame

Success criteria:
- no full translate-body rerender for ordinary visible row updates
- no visible spacer gaps after row patching
- smooth scrolling preserved during normal use

### M4: wire background sync to auto-refresh safe rows
Goal:
Replace stale-badge-only behavior for safe changed existing rows once a sync result is available.

Safe rows are:
- existing rows
- not focused
- not dirty
- not staleDirty
- not in conflict

Unsafe rows remain on current behavior:
- focused rows
- dirty rows
- staleDirty rows
- conflict rows
- inserted or reordered rows

Deliverables:
- sync-result handling filters changed rows into safe and unsafe sets
- safe rows are reloaded and patched
- unsafe rows remain stale/conflict
- structural changes remain deferred

Success criteria:
- safe remote updates appear automatically when a sync result arrives
- unsafe cases still protect local edits
- no structural live-update bugs introduced

### M5: tests, instrumentation, and hardening
Goal:
Add enough verification to catch scroll/layout regressions early.

Deliverables:
- targeted tests for:
  - visible row height change reconciliation
  - spacer updates after row patch
  - no blank gaps after repeated patch cycles
  - focus preservation for active row
- lightweight debug instrumentation for:
  - virtualization renders
  - row measurements
  - row patch batches
  - fallback full refresh count

Success criteria:
- regressions become easier to diagnose
- behavior is measurable rather than guesswork

## suggested file boundaries for refactor
This is a preferred direction, not a mandatory first step.

- `src-ui/app/editor-virtualization.js`
  - keep as thin public facade if practical
- `src-ui/app/editor-virtualization-layout.js`
  - pure height cache and window calculation
- `src-ui/app/editor-virtualization-controller.js`
  - scheduling, scroll, resize, reconcile orchestration
- `src-ui/app/editor-virtualization-dom.js`
  - DOM render, row patch, row measurement
- `src-ui/app/editor-virtualization-anchor.js`
  - anchor and focus restore helpers

If the current code is not ready for a full split, implement the seam first and defer file extraction until after behavior is stabilized.

## implementation order
1. Inspect current virtualization flow and document the exact row measurement and reconcile path.
2. Add the narrow public virtualization API.
3. Make row-level height invalidation flow through that API.
4. Reuse the normal row renderer for row patching.
5. Implement visible-row patching for already-updated state.
6. Wire background sync for safe rows only.
7. Add instrumentation and regression tests.
8. Reassess whether further module splitting is still needed.

## verification checklist
Run this after each milestone:
- Fast scroll through long content remains smooth.
- No blank space appears in the viewport.
- Top and bottom spacers remain correct.
- Focus stays stable in the active editing row.
- Textarea autosize changes still reconcile height correctly.
- Image or async content height changes still reconcile correctly.
- No ordinary background row update triggers full editor body rerender.
- Unsafe rows still remain protected.

## fallback rules
If any of these conditions are true, prefer the existing conservative path:
- too many rows changed at once
- inserted or reordered rows detected
- focused row affected
- dirty or conflict row affected
- virtualization cannot safely identify and patch the mounted row card

## completion definition
This work is complete when:
- safe stale rows update automatically
- virtualization remains smooth and stable
- structural and conflict cases remain conservative
- row-level updates do not rely on full translate-body rerender
- the new behavior is backed by targeted verification
