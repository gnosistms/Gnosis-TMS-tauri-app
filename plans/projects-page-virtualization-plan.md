# Projects Page Virtualization + Per-Team Scroll Restore

## Goal

1. Virtualize the projects page list with TanStack Virtual Core so teams with many
   projects/files scroll smoothly.
2. Save the scroll position when leaving the page and restore it on return.
   Positions are local-only, scoped per team, and invalidated when a new project
   appears (created locally or arriving via remote git sync).
3. Handle expand/collapse (open/closed projects) correctly: toggling changes the
   item list and total height, so restore must be anchor-based, not pixel-based.

## Current State (verified)

- **Render path**: `renderProjectsScreen(state)` in `src-ui/screens/projects.js`
  (~line 213) builds one HTML string; `main.js` (~line 724) sets `app.innerHTML`.
  Every `render()` recreates the whole DOM.
- **Rows**: `renderProjectCard()` in `src-ui/screens/project-list-render.js` emits
  one `<article class="card card--expandable">` per project. File rows
  (`chapter-table__row`, from `src-ui/screens/project-chapter-list-render.js`) are
  emitted inside the article only when expanded. Heights are variable
  (header ~60px, file row ~44px, optional deleted-files section).
- **Scroll container**: `<main class="page-body">` from `pageShell()` in
  `src-ui/lib/ui.js` (~line 492). `scroll-state.js` already captures/restores its
  raw `scrollTop` for same-screen re-renders
  (`captureRenderScrollSnapshot`/`restoreRenderScrollSnapshot`, main.js ~line 736).
- **Expand state**: `state.expandedProjects` (Set of `project.id`, `state.js:31`),
  toggled in `src-ui/app/actions/project-actions.js` (`toggle-project:` prefix).
  Not persisted; never cleared on team switch (harmless today because ids are
  UUIDs, but it means expand state is effectively global, not per-team).
  `state.expandedDeletedFiles` is the analogous set for deleted-files sections.
- **Data flow**: `state.projects` is owned by `project-query.js`; snapshots apply
  via `applyProjectsQuerySnapshotToState()`; the observer calls `render()` on every
  query result. Team identity is `state.selectedTeamId`. On team switch,
  `loadTeamProjects()` clears `state.projects` and seeds from localStorage cache.
- **Editor precedent** (PR #153): `editor-virtual-list.js` instantiates
  `Virtualizer` from `@tanstack/virtual-core` directly with spacer-based DOM
  (top spacer / items container / bottom spacer, `innerHTML` range replacement),
  a `Map<rowId, height>` cache with post-render `getBoundingClientRect()`
  measurement + `virtualizer.resizeItem()`, and `editor-scroll-session.js` for
  generation-arbitrated anchors. Persistence follows
  `editor-location.js` + `editor-preferences.js` over `persistent-store.js`.

## Design Decisions

### D1: Virtualize a flattened row list, not project cards

The stated pain is teams with a **huge number of files**. Virtualizing at
card granularity would still render every file row of an expanded project as one
giant DOM item, so it doesn't fix the actual problem. Instead, flatten the page
into a single list of typed items:

```
{ type: "project-header",  key: "p:<projectId>", project }
{ type: "project-extras",  key: "x:<projectId>" }            // resolution markup etc., when present
{ type: "file-row",        key: "f:<projectId>:<fileId>", project, file }
{ type: "deleted-toggle",  key: "dt:<projectId>" }
{ type: "deleted-file-row",key: "df:<projectId>:<fileId>" }
```

File/deleted items exist only while their project (and deleted section) is
expanded. Toggling a project inserts/removes items; TanStack handles this via
`getItemKey`. Each item has a near-constant height per type, which makes
estimation accurate and measurement cheap.

**Cost**: the `<article>` can no longer wrap header + body. Rows become siblings
styled as card segments (`card-segment--first / --middle / --last`) so the visual
result is unchanged. This is the main refactor risk and gets its own phase with a
pixel-parity check before any virtualization lands.

### D2: Anchor-based scroll position, raw scrollTop only as fallback

Because expand/collapse and remote updates change total height, a saved pixel
offset is meaningless. The saved position is an **anchor**:

```
{ itemKey, offsetTop }   // offsetTop = px from container top to item top
```

Restore fallback chain (this is the core of "handle open/closed well"):

1. `itemKey` exists in the current flat list → scroll so that item sits at
   `offsetTop`.
2. `itemKey` was a file row / deleted row whose project still exists but the row
   is gone (project collapsed, file deleted/renamed) → anchor to that project's
   header (`p:<projectId>`) at `offsetTop`.
3. Project gone entirely → discard, start at top.

### D3: Expand/collapse state stays in-memory (decided: no restart persistence)

A saved anchor pointing at a file row is only honorable if that project is still
expanded when we return. Within one app session `state.expandedProjects` already
survives navigation (module-level Set), so leave-and-return restores exactly,
including file-row anchors. After an app restart the Set is empty, every project
renders collapsed, and a saved file-row anchor degrades via fallback rule D2.2
to the owning project's header — acceptable and predictable.

Consequence: the persisted payload does **not** store expand state, and entry
does not mutate `state.expandedProjects`. The existing behavior of never
clearing the Set on team switch is deliberately kept — it is what makes
within-session restore work when returning to a previous team, and project ids
are UUIDs so there is no cross-team collision.

### D4: Invalidation = "a project id exists now that wasn't in the saved set"

The payload stores the project-id set at save time. On restore:

```
invalid = currentProjectIds.some(id => !saved.projectIds.includes(id))
```

- New project (local create or remote sync while away) → discard saved anchor,
  clear the stored entry, and open the page scrolled to the top (scrollTop 0,
  as on a first visit).
- Removals do **not** invalidate — the anchor chain (D2) handles missing items.
- Invalidation applies only to **restore-on-entry**. While the user is on the
  page, a remote snapshot adding a project must never yank the viewport: the
  live session anchor (D5) wins, and the next debounced save simply records the
  new id set.

### D5: Two layers, mirroring the editor split

- **Session layer** (in-memory): `projects-scroll-session.js` — current anchor +
  team id, updated RAF-throttled on scroll and after anchored renders. Used to
  keep the viewport stable across same-screen re-renders (query snapshots,
  expand/collapse) while on the page. Replaces the raw
  `captureRenderScrollSnapshot` path for the projects screen, since raw scrollTop
  doesn't survive item-list changes under virtualization.
- **Store layer** (persistent, local-only): per-login key via
  `persistent-store.js` (Tauri `app-state.json` / localStorage `gnosis-tms-`
  prefix), following `editor-preferences.js`:

```
key: "projects-scroll:<login>"
value: {
  [teamId]: {
    anchor: { itemKey, offsetTop },
    scrollTop,                    // coarse fallback
    projectIds: string[],         // invalidation basis (D4)
    savedAt: ISO string
  }
}
```

Save triggers: debounced (~300ms) on scroll while on the page (so app quit needs
no exit hook), on screen leave, and on team switch. Restore trigger: first
projects-screen render for a team with non-empty `state.projects` (localStorage
cache seeding means this is usually the first paint).

### D6: Virtualization is threshold-gated with a plain fallback

Follow the editor's routing pattern (`editor-virtualization.js`): if the flat
item count is below a threshold (proposal: **60 items**), render the full list
exactly as the refactored non-virtual path does. Small teams see zero behavior
change; the virtual path only engages where it pays.

### D7: Controller lifecycle across full re-renders

`main.js` recreates the DOM every `render()`. Same approach as the editor:

1. The screen renderer computes an **initial window** synchronously from the
   module-level height cache + target scrollTop (session anchor if present,
   else pending restore, else 0) and emits top spacer / visible items / bottom
   spacer HTML.
2. After the DOM is in place (the same post-render point where the editor's
   virtual controller mounts in `main.js`), `createProjectsVirtualListController()`
   instantiates the `Virtualizer` (`initialOffset: () => scrollContainer.scrollTop`,
   `getScrollElement: () => document.querySelector(".page-body")`,
   `estimateSize` from the type-based estimator backed by the cache,
   `getItemKey`, modest `overscan`), calls `_didMount()`/`_willUpdate()`,
   and thereafter handles scroll-driven range updates by replacing only the
   items-container `innerHTML` — no full `render()` on scroll.
3. Height cache is module-level, keyed by item key, reset on team switch.
   Post-render measurement updates it via `resizeItem()` exactly like
   `measureRowCardHeight` in `editor-virtual-list.js`.
4. Controller is destroyed on screen exit / next full render.

No focus pinning, language panels, or resize-adjustment regime gating needed —
the projects list is far simpler than the editor.

### D8: Expand/collapse keeps the toggled header stationary

When the user toggles a project, items are inserted/removed **below** the header
they clicked. Before the re-render, set the session anchor to that project's
header at its current viewport offset. Result: the header stays put and content
unfolds/folds beneath it — including when collapsing a project whose file rows
currently contain the anchor (rule D2.2 applied live).

## Implementation Phases

### Phase 1 — Flatten the row model (pure refactor, no behavior change)

- New `src-ui/app/projects-list-model.js`:
  `buildProjectsListItems(state)` → flat typed item array (D1) from
  `state.projects`, `state.expandedProjects`, `state.expandedDeletedFiles`;
  `estimateProjectsItemHeight(item)` per-type estimator.
- Split `renderProjectCard()` / chapter-list rendering into per-item renderers
  (`renderProjectsListItem(item, state)`) in `project-list-render.js` /
  `project-chapter-list-render.js`.
- CSS: card-segment classes so sibling rows compose visually into today's cards.
  All `data-action` wiring (toggle, rename, delete, add-files, file open) is
  per-row already and carries over.
- `renderProjectsScreen()` renders the full flat list through the new renderers.
- **Verify**: existing Playwright projects-page specs pass; screenshot comparison
  against `main` for collapsed, expanded, deleted-section, and resolution-markup
  states.

### Phase 2 — Virtualizer

- New `src-ui/app/projects-virtual-list.js` (modeled on `editor-virtual-list.js`,
  heavily simplified): controller creation, spacer math, range rendering,
  post-render measurement, teardown. Threshold gate (D6) in the screen renderer.
- Mount/teardown hooks in `main.js` beside the editor virtualization mount point.
- Height cache module + reset on team switch.
- **Verify**: browser test seeding a large synthetic team (e.g. 200 projects ×
  50 files, expanded) — DOM node count stays bounded while scrolling top to
  bottom; toggle/rename/delete/add-files actions still work on virtualized rows.

### Phase 3 — Session anchor + re-render stability

- New `src-ui/app/projects-scroll-session.js`: anchor + team scope +
  user-intent generation (copy the shape of `editor-scroll-session.js`; it is
  ~100 lines and screen-specific state keeps the modules independent).
- Scroll handler (RAF-throttled) computes the top-most visible item → session
  anchor. Full re-renders on the projects screen restore from the session anchor
  instead of raw scrollTop (`restoreRenderScrollSnapshot` bypassed for this
  screen).
- Expand/collapse pre-anchoring (D8).
- **Verify**: browser tests — background snapshot re-render doesn't move the
  viewport; toggling a tall project keeps its header stationary; collapsing the
  project containing the anchor re-anchors to its header.

### Phase 4 — Per-team persistence + invalidation

- New `src-ui/app/projects-scroll-store.js` over `persistent-store.js` (D5
  payload; per-login key; normalize/validate on read like
  `editor-preferences.js`).
- Save triggers (debounced scroll / leave / team switch); restore-on-entry with
  invalidation (D4) and fallback chain (D2).
- **Verify**: unit tests (Node) for payload normalization, invalidation
  predicate, fallback chain; browser tests — leave→return restores position
  (including file-row anchors, since in-memory expand state survives);
  restart-equivalent (fresh page load, empty expand state) falls back to the
  owning project's header; adding a project locally then returning opens at the
  top; two teams keep independent positions.

### Phase 5 — Polish & platform pass

- Run `npm test`, `npm run test:browser`, `npm run audit:unused`.
- Manual scroll-behavior pass on **Windows** as well as macOS (CLAUDE.md:
  virtualization scroll bugs differ per platform).
- Confirm no regressions to the generic `scroll-state.js` snapshot path used by
  other screens.

## Out of Scope (noted, not acted on)

- Glossary/QA list pages: the parity rule applies to resource *capabilities*;
  this is page-rendering infrastructure. If those pages later need
  virtualization, `projects-virtual-list.js` + the session/store modules are the
  template — consider generalizing then, not now.
- Persisting expand state anywhere (decided against restart persistence in D3;
  remote persistence was never in scope).

## Implementation Log (2026-07-05)

All five phases implemented and verified. Notes for future readers:

- **New modules**: `app/projects-list-model.js` (flat items, estimates, pure
  window/range math), `app/projects-virtual-list.js` (controller + plain
  tracker + initial-window resolver), `app/projects-scroll-session.js`
  (anchor), `app/projects-scroll-store.js` (per-login/team persistence,
  entry reconciliation, debounced saves), `screens/project-list-flat-render.js`
  (per-item renderers), `app/projects-page-fixture.js` (+
  `__gnosisDebug.mountProjectsFixture`) for browser tests.
- **Card chrome from segments**: sibling rows compose the card via
  border/radius segment classes; each segment's `--surface-shadow` copy is
  confined to its band with `clip-path`, and `--panel-surface`'s vertical
  gradient is flattened to its composite color (a per-segment gradient
  restart bands visibly). Inter-card gap is padding on the item wrapper
  (outside the chrome) — margins would break spacer math (measureElement
  excludes them).
- **scrollMargin**: `.page-body` holds content above/below the list, so the
  virtualizer runs with `scrollMargin` = list offset; item `start` values
  include it and the spacer math subtracts it back out
  (`resolveProjectsVirtualRangeState`).
- **Controller lifetime = one render**: no notifyRowsChanged surface; every
  state change is a full render that recreates the controller. Restores are
  coarse (estimated offsets, mirrored into `virtualizer.scrollOffset` because
  the scroll event lands post-paint) then fine (DOM delta).
- **Saves are scroll-driven only** (debounced 300ms, data captured at
  schedule time). No destroy-time flush: a project added after the last
  scroll is deliberately absent from the saved id set, which is exactly the
  invalidation the spec asks for (local additions invalidate too).
- **Deleted-projects section** intentionally still renders article-based
  cards via `renderProjectCard` (small, below the virtual list).
- **Scroll-perf iterations (same day)**: the initial implementation rebuilt
  the whole ~37-item window via innerHTML, re-measured every rendered item on
  every range change (~every 45px of scroll), and DOM-scanned rects per
  scroll event for the anchor — visibly janky on macOS. Final design after
  two rounds of tuning against feel-tests:
  - **Minimal window, patched incrementally.** Rendered range = the required
    range only (virtualizer overscan 2); every frame trims/inserts just the
    one-or-two edge items (insertAdjacentHTML/remove), measuring only
    insertions. Do NOT reintroduce full-window innerHTML replacement (short
    rows make range changes far more frequent than in the editor), and do NOT
    add an offscreen "runway": WKWebView does not pre-rasterize offscreen
    rows — a 24-item runway made hard-flick flicker chunkier, not smoother
    (one large late-painting block instead of one row). Same lesson as the
    editor's tuning: draw as little as possible outside the view.
  - **No deferred measurement.** An attempt to skip measuring inserted items
    during momentum (flush on settle) broke restore accuracy: virtual-core's
    settle-time compensation adjusts scroll for measurements that never moved
    the DOM (rendered items already occupy their real height; only spacers
    reflect estimates), producing a constant ~66px drift. Measure at insert;
    coordinates stay exact everywhere.
  - **Anchor capture** picks the candidate item arithmetically from
    virtualizer coordinates but reads that one element's rect for the offset
    (single DOM read per scroll event, layout is valid mid-scroll).
  - Opt-in probe `tests/browser/projects-scroll-bench.spec.js`
    (PROJECTS_SCROLL_BENCH=1), steady 40px/frame + fast 200px/frame: mean
    frame 15.6ms→8.3ms, p99 25.8ms→9.4ms, frames >17ms 167→0 per 999 (fast
    probe likewise 0).
  - **A/B switch**: `window.__gnosisDebug.setProjectsVirtualizationDisabled(true)`
    renders the full list unwindowed (anchor tracking and persistence stay
    active via the plain tracker) to compare virtualized vs plain scrolling
    on real data. **Verdict (Hans, macOS feel-test 2026-07-05): virtualized
    scrolling is slightly better than plain even after the edge-only-shadow
    fix — virtualization stays.** Residual hard-flick paint-in is WKWebView
    tile rasterization. Opaque precomputed background/border composites (no
    alpha blending in the scroll path) were also tried: no perceptible
    improvement on macOS, reverted to token-based colors. The one remaining
    untried lever is thinning per-row paint cost (five inline SVG icons + two
    pill controls per file row); expect modest gains at best — the floor is
    WKWebView's async-scroll tile scheduler.
- **WebKit paint cost**: `box-shadow` + `clip-path` on every segment scrolled
  smoothly on Chromium (Windows WebView2) but lagged on macOS WKWebView, so
  only the `--start`/`--end` edge segments carry the shadow (clipped at the
  seam with their neighbor); middle segments are plain painted boxes. The
  shadow's side bleed along the card body is imperceptible at 0.07 alpha.
- **Verified**: 19 unit tests (model/store) + 12 Playwright specs in
  `tests/browser/projects-page.spec.js`; full suite green
  (1570 unit / 109 browser). Windows manual scroll pass still pending
  (CLAUDE.md platform rule).

## Resolved Decisions

1. **Expand state does not persist across restarts** — in-memory only (D3);
   post-restart restores land on project headers via the fallback chain.
2. **Invalidation opens the page at the top** (scrollTop 0), like a first visit,
   rather than auto-scrolling to the new project.
3. **Virtualization threshold: 60 flat items** — a plain constant in
   `projects-virtual-list.js`; easy to tune later.
