# Editor connected-row indicator

Status: implemented; automated verification passed. Native macOS/Windows verification remains pending.
Design approved: 2026-09-16.

## Goal and approved behavior

Make it clear which translation row the right sidebar belongs to without adding
a connecting line or changing the editor's existing layout.

- Outline the selected row's translation card using the existing accent color.
  Keep its normal background. The outline persists when focus moves to the
  sidebar and returns when the row is remounted by virtualization.
- When any part of the selected row is visible in the left scroll pane, show no
  additional sidebar information. AI Assistant, Review, History, and Comments
  remain at the top of the sidebar card.
- When the entire selected row is above or below that viewport, insert one
  clickable row immediately above the tabs:
  - `↑ The connected text is scrolled above the top - click to show it.`
  - `↓ The connected text is scrolled below the bottom - click to show it.`
- Clicking the notice reveals the selected row and removes the notice once the
  row is visible. Keep the same selected language and sidebar tab.
- If a filter hides the selected row, disconnect the sidebar and clear the
  active selection. Show the existing appropriate empty state for the current
  tab. Removing the filter must not silently reconnect the old row.
- Scrolling a row out of view never clears selection. Virtualization unmounting
  is not filtering.
- Keep the app's current spacing, typography, colors, pane widths, and tab
  behavior. Do not add a vertical pane divider, row-number header, source-text
  excerpt, permanent navigation strip, or background tint.

The approved interactive reference is the outline-only version of
`editor-app-style.html` in the task's visualization directory:
`/Users/hans/.codex/visualizations/2026/09/16/01a0a9e2-0361-7eb1-bd8f-747afeb26356/`.
The behavior above is the durable specification; implementation must not depend
on the temporary preview server or copy the mockup's simplified virtualizer.

## Current implementation and integration points

| Area | Current code and implication |
| --- | --- |
| Selection | `src-ui/app/translate-flow.js`, `setActiveEditorField`, tracks `editorChapter.activeRowId` and `activeLanguageCode`, separately from `mainFieldEditor`. Use these existing identities, not DOM focus or a second selected-row state. |
| Row markup | `src-ui/app/editor-row-render.js` renders a `[data-editor-row-card]` shell containing `.card--translation`. The card currently has no persistent connected-row styling. |
| Filtered model | `src-ui/app/editor-screen-model.js` builds `editorFilters.filteredRows`, then `contentRows` including deleted-row group markers. Actual row items must be distinguished from those markers. |
| Sidebar | `src-ui/screens/translate-sidebar.js` renders one shared card body with `.history-tabs` followed by the chosen pane. This is the single location for the notice across all four tabs. |
| Render lifecycle | `src-ui/main.js` has full, body-only, sidebar-only, and visible-row render paths. Body/full renders initialize virtualization; sidebar-only renders replace sidebar markup independently. |
| Virtual scrolling | `src-ui/app/editor-virtual-list.js` owns TanStack Virtual Core, `currentRowIndexById`, estimates, measured heights, and scheduled range renders. Focused/anchored rows may be pinned outside the viewport, so DOM presence and virtual-window membership do not establish visibility. |
| Small chapters | `src-ui/app/editor-virtualization.js` also owns the non-virtualized fallback lifecycle. Both paths need identical indicator behavior. |
| Scroll ownership | `editor-scroll-session.js` owns user-scroll generation and the session anchor. `scroll-state.js` has `centerTranslateRowInView`, but it requires a mounted row. A reveal operation must also handle unmounted rows. |
| Filter changes | `editor-search-flow.js` updates query/mode/case settings. `renderEditorRowScoped` falls back to a body render while filters are active because content edits can change membership. Reconciliation cannot be limited to filter-control events. |

This is frontend editor-session work. No Rust commands, network requests,
storage migrations, additional libraries, or resource collection cache changes
are needed.

## Implementation steps

### 1. Establish selection and membership reconciliation

- Add a small editor connection helper, provisionally
  `src-ui/app/editor-row-connection.js`, for pure selection/membership and
  visibility decisions. Keep DOM lifecycle code separate from the pure logic.
- Derive the connected identity from the current chapter, `activeRowId`, and
  `activeLanguageCode`. Do not persist `above`/`below` flags in chapter data.
- Reconcile selection against the authoritative filtered row model before
  producing sidebar/row markup. Put the state-changing orchestration in the
  editor render/flow layer, not in the pure screen-model builder. Reuse the model
  for this pass; rebuild after clearing selection if necessary to avoid stale
  selection-dependent cached sections.
- Cover explicit search/filter changes and changes to filter membership caused
  by edits, review markers, comments, image changes, or background updates.
  Cover full/body renders and independent sidebar/row refresh paths; a stale
  selected row must never remain actionable in the sidebar.
- On confirmed exclusion or removal, clear `activeRowId` and
  `activeLanguageCode`, and reset row-bound open-editor/pending-selection,
  history, and comments view state consistently with the existing clearing
  patterns in `editor-row-sync-flow.js` and `editor-row-structure-state.js`.
  Preserve the chosen sidebar tab, dirty text/write intents, and saved
  per-row assistant conversations/drafts. Do not treat disconnection as deleting
  content or cancelling an already submitted save.
- Keep existing stale-request guards effective: a late history/comments/AI
  result must not reconnect a cleared selection or populate another row's
  sidebar. Add a targeted guard only where the current request identity is
  insufficient.
- Do not clear selection from a temporarily unavailable model during loading or
  controller teardown. Distinguish authoritative exclusion from “not measured
  yet.” Existing chapter/language removal logic remains responsible for invalid
  identities. If a selected deleted row becomes hidden inside a collapsed group,
  disconnect rather than reporting a misleading offscreen direction.

### 2. Render a persistent outline and shared notice slot

- Expose an `isConnected` row property in `editor-screen-model.js`, based on row
  identity. Render a corresponding class/data attribute in
  `editor-row-render.js` so full renders, patches, and remounts agree.
- In `src-ui/styles/translate.css`, style only the translation card outline
  using existing theme tokens. Avoid changing background, padding, border
  thickness, or measured row size when selection changes. Preserve native focus
  styling and existing deleted/conflict states.
- Ensure changes of selection refresh the old and new mounted row indicators
  even on paths that refresh only the sidebar or history. Do not remount the
  editor body just to move an outline.
- Add a hidden native button immediately before `.history-tabs` in the shared
  sidebar renderer. Use the exact text above and a small up/down arrow, with the
  arrow marked decorative for assistive technology. The whole text row is the
  click target, can wrap at narrow widths, and has a visible keyboard focus ring.
- Hidden means no layout space and no keyboard stop. Keep this notice within
  the existing right pane's scroll surface; do not introduce a sticky overlay or
  alter either pane's scrolling model.

### 3. Derive visibility from the actual viewport

- Extend the existing virtualization controller interface with a narrow
  row-geometry/visibility query. The virtual controller owns the mapping from
  row ID to the current filtered item index and measured/estimated offsets.
  Verify the installed TanStack API before choosing the exact accessor; do not
  expose its private caches to sidebar code.
- For a mounted row, compare its current shell bounds with the left pane's
  inner viewport bounds. For an unmounted row, use the virtualizer's row start
  and end offsets in the same coordinate system as the scroll offset. Include
  list offsets and gaps correctly; never multiply an index by a fixed row height.
- Classify `above` when the row's bottom is at or above the viewport top,
  `below` when its top is at or below the viewport bottom, otherwise `visible`.
  Any positive overlap counts as visible, including very tall or partly clipped
  rows. This is row visibility, not whether the selected language's text is
  individually visible inside a partly visible row.
- Membership is checked separately and first. A row absent from the filtered
  model is disconnected, while a row absent only from the DOM remains connected.
  Overscan and focus pinning do not affect these rules.
- Implement the equivalent mounted-bounds query for small/non-virtualized
  chapters. If valid geometry is temporarily unavailable, hide the notice and
  retry after measurement; never invent a direction or clear selection.
- Add a lightweight DOM synchronizer, provisionally
  `editor-row-connection-dom.js`. Coalesce updates with animation frames and
  mutate only the notice's hidden state, arrow, and text when needed. Scrolling
  must not render an entire sidebar, reload history, rebuild every row model,
  disturb assistant drafts, or write scroll position.
- Trigger synchronization on scroll, selection, virtualizer measurement/range
  updates, row height changes, pane resize, filter/layout changes, and after
  full/body/sidebar/row-patch rendering. In particular, scrolling within an
  unchanged virtual range must still update visibility.
- Re-query replacement nodes after renders. Cancel scheduled work and detach
  observers/listeners on controller destruction, chapter changes, and leaving
  Translate mode. Do not retain row DOM references across virtual range changes.

### 4. Reveal through the existing scroll lifecycle

- Add a delegated `show-connected-editor-row` action in
  `src-ui/app/actions/translate-actions.js`, backed by a controller reveal
  operation exposed through `editor-virtualization.js`.
- At activation, re-read the chapter and selection and confirm current filtered
  membership. Never clear filters or reuse `showEditorRowInContext`, which
  intentionally changes filter state.
- Treat reveal as deliberate user scroll intent through
  `noteUserScrollIntent`. For an unmounted row, jump using its virtual item
  position so the existing range renderer mounts it; then, if measurements
  require it, make a bounded alignment correction under the same intent.
  Centre ordinary rows and align the top of a row taller than the viewport.
- Reuse existing mounted-row centering where appropriate, adapting its intent
  handling if necessary. Do not create an independent capture/restore loop or
  another resize-compensation mechanism. Avoid smooth scrolling against changing
  row estimates.
- Any delayed correction must carry chapter ID, selected row ID, and scroll
  generation, and stop if the user scrolls, changes selection/filter, or leaves
  the chapter. Update the session anchor so subsequent renders preserve the new
  location.
- Keep sidebar tab, active language, text, drafts, and caret state intact. The
  reveal action does not enter editing. Audit `translate-editor-dom-events.js`
  focus-preservation selectors so pointer activation does not cause a destructive
  blur or lose the click during a sidebar replacement. For keyboard activation,
  when the notice disappears, move focus to a suitable existing control in the
  revealed row with `preventScroll`, without synthesizing an edit action.

## Validation and acceptance criteria

Extend the existing unit/renderer suites and add focused cases to the browser
editor regression suite using the existing fixture. Test behavior rather than
source-string wiring.

1. Selecting A then B leaves exactly B outlined; the selected and unselected
   card backgrounds match. Moving focus to every sidebar tab preserves the
   outline. Row patching and virtual remounting preserve the same identity.
2. Visible and partly visible rows show no notice. Completely above/below rows
   show the matching exact message and arrow. Cover viewport-edge equality,
   variable heights, a row taller than the viewport, and a focused pinned row.
3. In a large fixture, confirm the selected row is actually unmounted before
   asserting direction and clicking reveal. Do not accidentally test only
   overscanned rows. Repeat with a chapter below the virtualization threshold.
4. Reveal mounts and exposes the intended row, hides the notice, retains the
   active language/tab, and does not change text. A newer manual scroll or
   chapter switch wins over pending reveal correction.
5. Query, case-sensitive search, and row filters disconnect only when they
   exclude the selected row. Clearing filters does not restore that selection.
   Include zero matches, a filter that still includes the row, and a content or
   marker update that removes the row from the active filter.
6. Late async results cannot reconnect a filtered-out or deleted row. Dirty
   edits and assistant/comment drafts survive the appropriate existing save
   lifecycle. Merely scrolling never clears them.
7. Resize the window, change font size, collapse languages, load an image, and
   patch text while the selected row is offscreen. Direction remains correct;
   no scroll jumps, flicker loop, lost focus, or unnecessary sidebar remounts.
8. Check keyboard activation and focus after notice removal, text wrapping,
   read-only users' available tabs, offline operation, and Preview/Translate
   transitions. No notice appears in Preview mode.

Run focused tests during implementation, then `npm test`,
`npm run test:browser`, and `npm run audit:unused` before marking the work complete.
Verify the scrolling/reveal cases in the native app on both macOS and Windows,
including trackpad/wheel and scrollbar dragging. Browser-only success does not
complete the required Windows virtualization verification.

## Scope and delivery

Implement as one cohesive frontend feature in small focused commits: selection
reconciliation and outline; viewport notice and reveal; regression coverage.
Do not redesign the sidebar or replace the virtualization/scroll architecture.
The notice and outline are always-on behavior, with no new preference or feature
flag. Implementation follows the approved behavior above; no commits were created.


## Implementation record — 2026-09-16

- Added `editor-row-connection.js` for filter reconciliation and viewport
  classification, and `editor-row-connection-dom.js` for the notice/outline
  lifecycle and guarded reveal.
- Full and scoped renders reconcile filtered selection before rendering.
  Sidebar/row/header scopes upgrade to a body render when exclusion requires
  removal. Comment drafts and assistant threads are retained; old history/comment
  requests cannot reconnect the selection.
- Virtualized bounds use Virtual Core's public `measurementsCache`, refreshed
  through `getTotalSize`, behind the controller API. Bounds include the actual
  list offset. Mounted rows use actual viewport geometry, including pinned rows.
- Scroll updates only synchronize the indicator. Reveal performs an immediate
  jump and one measurement correction guarded by chapter, row, and user-scroll
  generation. Keyboard reveal returns focus without opening an editor.
- Shared sidebar markup places the hidden button above tabs. Row styling adds
  only an outline and does not change measured size or background.

Verification:

- `npm test`: 2,178 frontend tests and 23 workflow tests passed. The workflow
  tests used the available fallback Git and localhost access; system Git is
  blocked by the unaccepted Xcode license.
- Full browser suite in installed Chrome: 157 passed, one existing benchmark
  skipped. The three subsequently added feature cases also passed in the final
  targeted run (five feature cases total).
- All five feature cases passed in Chrome and macOS WebKit: small/virtualized
  chapters, both directions and reveal, unchanged backgrounds, keyboard focus,
  filtering, partial/pinned rows, resize, content-driven exclusion, and newer
  scroll intent cancelling pending reveal correction.
- `npm run build` passed. Targeted ESLint had no errors, with two existing
  warnings in row rendering and DOM events. `git diff --check` passed.
- `npm run audit:unused` reports only the existing three unused scripts, five
  absolute browser-test imports, and `ensureEditorFootnoteEntry`; no new findings.
- Native Tauri testing on macOS and Windows is still outstanding. WebKit testing
  is not a substitute for those platform checks. No Windows host is available
  here, and this Mac's Xcode license blocks native toolchain use.
- Preserved the pre-existing uncommitted assistant composer scroll changes and
  unrelated audit documents.

## Follow-up — connections to deleted rows

Requested behavior: expanded soft-deleted rows remain eligible for sidebar
selection. Closing their deleted-row section disconnects them; reopening does
not restore the connection. Permanent deletion always disconnects the deleted
row, while leaving a connection to another row intact.

Implementation steps:
1. Keep selection when a soft delete leaves the row in an expanded group (or the
   Deleted rows filter). Clear it immediately when its own group closes.
2. Keep remote soft-delete reloads eligible for selection; retain the existing
   hard-delete cleanup and authoritative filtered-membership reconciliation.
3. Cover selection of an expanded deleted row, scrolling/reveal, collapse/reopen,
   soft deletion into an open group, and permanent deletion in unit/browser tests.


Follow-up implemented and verified:
- Expanded deleted rows can retain or acquire selection; closing their own group
  clears it immediately, and reopening does not select them again.
- Soft deletion into an open group preserves the connection. Remote soft-delete
  reloads preserve group expansion when groups merge and use normal visibility
  reconciliation. Missing/permanently deleted rows still clear selection.
- Two new browser scenarios passed in both Chrome and macOS WebKit, including
  virtualized deleted-row reveal and permanent deletion through its confirmation
  dialog. Expanded/collapsed membership and local deletion transitions are also
  covered by unit tests.
- Final `npm test`: 2,180 frontend tests and 23 workflow tests passed. Targeted
  ESLint and `git diff --check` passed. Unused-code audit findings remain unchanged.
- Native platform checks remain pending as recorded above; no commits were made.
