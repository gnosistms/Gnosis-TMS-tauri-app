# Editor Virtualization Refactor Plan

## Summary

Replace the fragile custom editor virtualization math with a small editor-specific adapter around a proven headless virtualizer. Keep the current vanilla JavaScript frontend and the existing row renderer. Do not migrate the app to a UI framework.

Recommended library: `@tanstack/virtual-core`.

## Goals

- Eliminate blank gaps while fast scrolling long files.
- Reduce post-inertia scroll jumps.
- Preserve smooth scrolling and stable spacer behavior.
- Preserve focused editor rows, dirty-row protections, conflict protections, and visible-row patching.
- Keep the change narrow enough to review and roll back.

## Non-Goals

- Do not rewrite the editor UI.
- Do not migrate to React, Svelte, Vue, or another frontend framework.
- Do not change row rendering markup unless the virtualizer adapter requires a small data attribute or wrapper adjustment.
- Do not change editor persistence, sync, AI, comments, glossary, image, or marker behavior except where those flows notify virtualization.

## Current Problem

The current editor virtualizer owns too many responsibilities at once:

- range calculation
- estimated row heights
- measured row height cache
- top and bottom spacer math
- scroll anchoring
- focused field restoration
- delayed height reconciliation
- visible-row patch integration
- image, textarea, footnote, glossary, and AI-driven height changes

The editor rows are highly dynamic:

- rows have variable height
- textareas autosize
- images load asynchronously
- footnotes and image captions expand/collapse
- glossary highlighting can change layout after render
- background sync and AI updates patch visible rows
- active/focused/dirty/conflicted rows need conservative handling

Blank gaps and scroll jumps indicate the custom estimated-height math and actual DOM measurements are drifting apart.

## Proposed Architecture

Create a new adapter module:

```text
src-ui/app/editor-virtual-list.js
```

The adapter owns:

- virtualizer creation
- scroll element wiring
- row count
- stable row keys
- estimated row height
- measured row height updates
- overscan
- render range calculation
- scroll-to-row helpers

The editor continues to own:

- row HTML rendering
- row IDs and language state
- dirty/focused/conflict protections
- persistence
- glossary, AI, image, comments, and marker behavior

## Adapter API

Expose an API shaped like the current virtualization controller:

```js
{
  renderNow(reason, options),
  notifyRowsChanged(rowIds, options),
  notifyRowHeightMayHaveChanged(rowId, source, options),
  refreshLayout(anchorSnapshot),
  destroy()
}
```

Keep these public functions stable:

- `notifyEditorRowsChanged`
- `notifyEditorRowHeightMayHaveChanged`
- `syncEditorVirtualizationRowLayout`
- `refreshEditorVirtualizationLayout`
- `invalidateEditorVirtualizationLayout`

Existing callers should not need broad rewrites.

## Rendering Strategy

Keep using:

```js
renderTranslationContentRowsRange(...)
```

The adapter decides which range to render. The current renderer still produces the row cards.

This avoids touching:

- row UI
- active editor field behavior
- AI assistant/review/translate controls
- comments
- glossary buttons and highlights
- image upload and preview UI
- conflict resolution UI

## Measurement Strategy

Use TanStack Virtual as the source of truth for:

- visible virtual items
- total virtual height
- measured item sizes
- scroll offset

Use stable row IDs as virtual item keys.

Use conservative `estimateSize` values based on the existing row estimator at first. Prefer overestimating to avoid under-rendering.

After rendering a range:

1. sync textarea heights
2. restore focus
3. restore mounted glossary highlights from cache
4. measure mounted row cards with the virtualizer

For mounted rows, use either:

- `measureElement`, if it fits the DOM structure cleanly
- a `ResizeObserver` per mounted row card
- explicit `resizeItem` calls when row layout changes

Existing row layout notifications should route through the adapter:

- textarea autosize
- image load/error
- footnote open/collapse
- image caption open/collapse
- image URL editor open/collapse
- glossary highlight sync
- visible row patching
- AI translation row updates
- marker/comment updates when they affect row height

## Scroll Anchoring

Keep the existing anchor helpers initially:

- `captureVisibleTranslateRowLocation`
- `queueTranslateRowAnchor`
- `restoreTranslateRowAnchor`
- `pendingTranslateAnchorRowId`

The adapter should control timing:

1. capture anchor before render when needed
2. update virtualizer state
3. render visible range
4. measure mounted rows
5. restore focused field
6. restore scroll anchor only when the operation is not an ordinary scroll frame

Do not introduce new automatic scroll jumps during ordinary scrolling.

## Feature Flag

Add an internal switch:

```js
const EDITOR_USES_TANSTACK_VIRTUALIZER = true;
```

Keep the old virtualizer temporarily so we can compare behavior and roll back quickly.

The flag can live in `editor-scroll-policy.js` or a nearby editor virtualization policy module.

## Migration Steps

1. Add `@tanstack/virtual-core`.
2. Create `src-ui/app/editor-virtual-list.js`.
3. Wrap TanStack Virtual behind the adapter API.
4. Integrate the adapter in `editor-virtualization.js` behind the feature flag.
5. Keep `renderTranslationContentRowsRange(...)` as the rendering path.
6. Preserve existing exported notification functions.
7. Route row-height notifications to the adapter measurement methods.
8. Verify fast scrolling, focus preservation, and visible row patches.
9. Remove the old deferred reconcile and coverage-gap patches once the adapter is stable.
10. Delete the old virtualizer path after a release or two if no regressions appear.

## Test Plan

Unit tests:

- adapter uses stable row keys
- adapter updates visible range when scroll offset changes
- adapter updates measured item size when row height changes
- adapter handles inserted/deleted rows safely
- adapter ignores invalid row IDs in notification calls
- existing notification exports still call into the active controller
- anchor restoration is skipped for ordinary scroll frames
- anchor restoration is used for layout refreshes and row patch operations

Manual tests:

- fast-scroll long files
- inertial trackpad scrolling on macOS
- scroll slowly through long variable-height rows
- expand and collapse textareas
- open and close footnotes
- open and close image captions
- load rows with images
- upload/remove images
- apply glossary highlights after scrolling settles
- AI Translate All visible row updates
- background sync visible row patching
- active editor focus survives visible row patching
- spacer heights remain correct at top, middle, and bottom of long files
- no visible blank gaps appear

## Verification Checklist

- Smooth scrolling remains intact.
- No app-background gaps appear between cards.
- No persistent blank space appears below the last rendered visible card unless the file is actually at the end.
- Spacer heights remain correct.
- Focus is preserved for the active editor row.
- Dirty, staleDirty, and conflict rows are not overwritten.
- Textarea and image-driven height changes reconcile correctly.
- Background sync does not force full translate-body rerenders for ordinary row updates.

## Risks

- TanStack Virtual integration may require a small wrapper style change around virtual rows.
- Measuring dynamic DOM rows too often could affect scroll performance.
- Scroll anchor restoration could fight the virtualizer if timing is wrong.
- Glossary highlighting may still need a post-highlight measurement notification.

## Rollback Plan

Keep the current virtualizer behind the feature flag until the new adapter is proven.

If regressions appear:

1. switch `EDITOR_USES_TANSTACK_VIRTUALIZER` to `false`
2. keep all existing row rendering and notification callers unchanged
3. investigate the adapter without blocking editing workflows
