# Editor Scroll Ownership Redesign — Implementation Plan

Status: P0–P4 implemented and committed on fix/editor-scroll-ownership
(pushed 2026-07-05; browser suite green on Linux and Windows CI). P5
(machinery deletion) pending. Before release: Windows-teammate canary for
OS scrollbar/wheel input, the one thing CI cannot exercise. See the
implementation logs at the end for what landed and what implementation
taught us that revised the design below.

## Problem

Scroll preservation in the translate editor has consumed 30+ bug-fix commits.
The audit (this document, first half) found the cause is structural, not a
series of implementation slips. The guarantees the system must give:

1. Scroll never jumps while the user is scrolling.
2. Position is saved/restored when leaving and returning to the editor
   (other screens, preview mode).
3. Position is saved when activating a filter and restored on return to
   show-all.
4. Scrolling stays smooth/fast via TanStack Virtual.
5. No jump from actions that don't logically imply scrolling (buttons,
   opening/closing editors, inserting/deleting images, async completions).

## Root causes (condensed — see git history of this file for full audit)

- **A. Opt-in correctness.** Every mutation call site must capture a viewport
  snapshot before its first `await` and thread it through optimistic /
  success / error renders. ~16 modules participate; forgetting any step on
  any path is a jump bug (the 2026-07 image-delete bug was exactly this).
- **B. Remount-then-compensate rendering.** `translate-body` renders destroy
  DOM (`innerHTML`) — including destroying and recreating the entire virtual
  list controller via `initializeEditorVirtualization` — then correct the
  visual shift after the fact, across paints, racing image loads, autosize,
  and the virtualizer's measure loop.
- **C. DOM-identity anchors** captured from live elements and restored via
  `querySelector`, in a system whose virtualizer unmounts those elements
  (hence the fallback cascades and the `pinnedRowIndex` range hack).
- **D. Stale restores fight the user.** `restoreTranslateViewport` writes
  `scrollTop` unconditionally from a possibly seconds-old snapshot; delayed
  restores are cancelled on typing but not on scrolling. Guarantee 1 is
  violated by design; no call-site patch can fix it.
- **E. No owner.** At least five independent writers of `scrollTop`
  (render snapshot restore in `main.js`, viewport restore, virtualizer anchor
  restore, editor-location restore, bottom-pin/center helpers) coordinate via
  module-global flags.

## Current mechanism inventory (what gets consolidated)

| Mechanism | Module | Fate |
|---|---|---|
| Raw scrollTop snapshot/restore + lock | `scroll-state.js`, `main.js` | Keep for non-translate screens; translate path replaced (P2) |
| DOM-anchor capture/restore cascade | `scroll-state.js` | Absorbed into session module (P1–P2) |
| Viewport snapshot threading | `translate-viewport.js` + 7 flow modules | Deleted (P5) |
| Primed pointerdown anchors | `events.js`, `translate-editor-dom-events.js` | Deleted (P5) |
| Pending-anchor module global | `scroll-state.js` | Replaced by session anchor + explicit jump requests (P5) |
| Virtualizer-internal anchoring + `suppressNextScrollRender` | `editor-virtual-list.js` | Becomes the session's writer (P1, P3) |
| Persistent location state machine | `editor-location.js` | Simplified to session reads/writes (P4) |
| Filter viewport transitions | `editor-search-flow.js` | Simplified to session reads/writes (P4) |
| Bottom-pin / center-row helpers | `editor-image-flow.js`, `scroll-state.js` | Re-expressed as user-intent scroll requests (P1) |

Call sites of `captureTranslateViewport` / `renderTranslateBodyPreservingViewport`
/ `restoreTranslateViewportAfterPaints` to migrate and delete:
`editor-image-flow.js` (18), `editor-persistence-flow.js` (8),
`translate-flow.js` (5), `translate-editor-dom-events.js` (5),
`editor-search-flow.js` (4), `editor-ai-translate-flow.js` (4),
`editor-ai-review-flow.js` (4).

## Target architecture

One new module owns the invariant; existing modules shrink.

### New module: `src-ui/app/editor-scroll-session.js`

Module-level state (survives virtual-list remounts and body renders — same
pattern as `rowHeightCacheByLayoutKey` in `editor-virtualization.js`):

```js
sessionAnchor        // { type, rowId, languageCode, offsetTop } — model space
lastUserScrollInputAt // timestamp of last wheel/touch/scrollbar/key scroll input
```

API:

- `noteUserScrollIntent()` — called from input events that mean "the user is
  scrolling": `wheel`, `touchmove`, scrollbar drag (pointerdown on the
  container outside content), and scroll-keys (PageUp/PageDown/Space/arrows
  when the scroll container has focus). A plain `scroll` event is NOT used —
  it fires for programmatic writes too, which is why intent must come from
  input events.
- `updateSessionAnchor()` — recompute the anchor from the current viewport
  (first fully/partially visible row + pixel offset). Called from the
  controller's scroll handler (RAF-throttled) and after every anchored
  render. This is the continuous capture that replaces per-call-site
  capture.
- `readSessionAnchor()` — current model-space anchor.
- `seedSessionAnchor(anchor)` — set before entering the editor or restoring
  a filter, so the first render anchors to it.
- `writeScroll(applyFn, { userIntent = false, reason })` — the single gate
  for every programmatic `scrollTop` write on `.translate-main-scroll`.
  Refuses (returns false, logs via `logEditorScrollDebug`) when
  `now - lastUserScrollInputAt < USER_SCROLL_PRIORITY_WINDOW_MS` and
  `userIntent` is false. macOS momentum scrolling keeps emitting wheel
  events, so the window keeps refreshing during a fling.

Constant `USER_SCROLL_PRIORITY_WINDOW_MS` (start at 200ms) lives in
`editor-scroll-policy.js` next to `EDITOR_USES_TANSTACK_VIRTUALIZER`.

### Rules after migration

- The virtual list controller (and the non-virtualized fallback in
  `editor-virtualization.js`) is the only code that computes the session
  anchor; everything else reads it.
- Every translate render re-anchors from the session anchor as part of the
  render — preserve-by-construction, no after-paint restore loops.
- All programmatic scrolls (restore, center, pin-to-bottom, jump-to-match)
  go through `writeScroll`; deliberate navigation passes `userIntent: true`.
- Row-scoped mutations render via row patching (`translate-visible-rows` /
  `patchMountedEditorRows`), not body remounts; height changes flow through
  `virtualizer.resizeItem`, whose scroll compensation for items above the
  viewport is verified/enabled (see P3).

## Phases

Each phase is independently shippable and leaves the app strictly better.
Risk decreases monotonically: P1–P2 are additive; P3+ remove code.

### Phase 0 — Acceptance tests that pin the guarantees (~1–2 days)

Extend `tests/browser/editor-regression.spec.js` (or a new
`editor-scroll.spec.js` using the same fixture) with one scenario per
guarantee, asserting `.translate-main-scroll` positions:

1. Start a slow queued write (image URL save with delayed backend), wheel-
   scroll during the pending window, let the write complete → position equals
   where the user scrolled to. **Expected to fail today** (root cause D) —
   mark `test.fail()` until P1 lands, then flip.
2. Delete an image below the fold and above the fold → anchored content does
   not move (passes today via the 2026-07 fix + unit test in
   `editor-image-flow.test.js`).
3. Activate each row filter, scroll, return to show-all → position restored.
4. Leave to projects / glossaries / preview and return → position restored.
5. Open/close image URL + upload editors, toggle reviewed/please-check,
   open/close footnote editor → no movement.

Deliverable: red/green baseline that every later phase must keep green.

### Phase 1 — `editor-scroll-session.js`: single owner + arbitration (~2–3 days)

1. Create the module with the API above + unit tests (node, no DOM — inject
   clock and container reads like `scroll-state.test.js` does).
2. Wire intent capture: `wheel`/`touchmove`/scroll-key listeners on the
   translate scroll container, registered by the virtual list controller
   (both engines) alongside the existing `scroll` listener; controller's
   scroll handler calls `updateSessionAnchor()` RAF-throttled.
3. Route every existing programmatic writer through `writeScroll`:
   - `restoreTranslateViewport` / `restoreTranslateRowAnchor` /
     `centerTranslateRowInView` (`scroll-state.js`, `translate-viewport.js`)
   - `scrollTranslateMainToBottom` (`editor-image-flow.js`, `userIntent: true`
     — it responds to the user opening the upload editor)
   - `scrollTranslateMainToTop` (`editor-search-flow.js`, `userIntent: true`)
   - `restoreEditorLocationSnapshot` (`editor-location.js`)
   - jump-to-search-match / show-row-in-context (`userIntent: true`)
4. Flip Phase-0 test #1 to passing.

This fixes guarantee 1 globally and ships alone. No behavior change for any
non-conflicting path.

### Phase 2 — Default-safe renders (~1–2 days)

1. In `main.js`, extend `resolveTranslateRenderAnchor`'s chain from
   `pending anchor → activeElement` to
   `pending anchor → activeElement → readSessionAnchor()` (keep the DOM
   visible-location scan only as final fallback when the session is empty,
   e.g. first render). Apply in both `renderTranslateBodyOnly` and the
   full-render translate→translate path.
2. Make `restoreTranslateViewport` anchor-first: only write raw `scrollTop`
   when no anchor is resolvable, instead of always writing it before
   anchoring. (This removes the second half of root cause D — stale raw
   offsets — even before call sites migrate.)
3. Call `updateSessionAnchor()` at the end of each anchored render so the
   session tracks post-render truth.

Acceptance: temporarily reverting the image-delete fix in
`editor-image-flow.js` must leave its regression test and Phase-0 test #2
green (default-safety catches it). Re-apply the fix regardless — explicit
beats implicit for the anchor row.

After this phase, a call site that forgets snapshot threading degrades to
"anchor from the session" — correct in virtually all cases. New-bug supply
is cut off here.

### Phase 3 — Row-scoped mutations stop remounting (~2–4 days, riskiest)

1. Verify/enable resize compensation: the installed `@tanstack/virtual-core`
   adjusts scroll on `resizeItem` when the resized item starts above the
   current offset (`shouldAdjustScrollPositionOnItemSizeChange` default).
   Check interaction with `restoreAnchorSnapshot` in
   `editor-virtual-list.js` — compensation must not be applied twice. Decide:
   either rely on the built-in adjustment and drop the anchor restore for
   resize-only renders, or set `shouldAdjustScrollPositionOnItemSizeChange:
   () => false` and keep anchor restores. One mechanism, not both.
2. Migrate row-scoped mutation renders from `{ scope: "translate-body" }` to
   `{ scope: "translate-visible-rows", rowIds }` +
   `notifyEditorRowsChanged`, domain by domain, in this order (smallest blast
   radius first): image operations → marker toggles → footnote open/close →
   text-style changes → persistence-flow save confirmations.
   `patchMountedEditorRows` already handles focus preservation.
3. `translate-body` remains for structural changes only: row insert / delete
   / merge, filter changes, language collapse, font size, chapter load.

Windows note (root `AGENTS.md`): virtualization scroll behavior differs on
Windows — run the Phase-0 suite and a manual pass on Windows before release.

### Phase 4 — Persistence and filter restore on the session anchor (~2 days)

1. `editor-location.js`: `persistEditorLocationForChapter` reads
   `readSessionAnchor()` instead of `captureVisibleTranslateLocation()`
   (DOM-independent; works while anchor rows are unmounted). The stored
   shape (`type, rowId, languageCode, offsetTop, scrollTop`) is already the
   session-anchor shape — no store migration.
2. Restore-on-entry: `seedSessionAnchor(savedLocation)` before the first
   translate render; the render anchors to it via the P2 chain. Delete the
   `pendingRestoreSnapshot` / `restoredChapterId` state machine and
   `skipNextEditorLocationRestore` where possible. Keep the separate preview
   raw-scrollTop store (preview has no rows).
3. `editor-search-flow.js`: filter activation saves the session anchor keyed
   by chapter; returning to show-all seeds it back. Delete
   `prepareEditorFilterViewportTransition` plumbing.

Covers guarantees 2 and 3 with store reads/writes instead of bespoke code.

### Phase 5 — Delete the deprecated machinery (~1–2 days + bake time)

After all call sites migrate:

- Remove snapshot threading from the 7 flow modules (inventory above).
- Delete `translate-viewport.js` (`captureTranslateViewport`,
  `renderTranslateBodyPreservingViewport`, `restoreTranslateViewportAfterPaints`,
  `cancelPendingTranslateViewportRestores`).
- Delete primed-anchor APIs and the `pendingTranslateAnchor` queue from
  `scroll-state.js` (navigation jumps are `writeScroll` user-intent
  requests); keep the raw per-screen snapshot for non-translate screens.
- Re-evaluate `lockScreenScrollSnapshot` (3 users: `editor-background-sync.js`,
  `navigation.js`, `editor-preview-flow.js`) — preview mode-switch likely
  still needs it; background-sync's lock should be unnecessary once sync
  renders are row patches.
- `npm run audit:unused` must show no regressions; update the Scroll
  Preservation section of `src-ui/AGENTS.md` to name the session module as
  owner and state the two rules (renders re-anchor from the session; all
  programmatic scrolls go through `writeScroll`).
- Keep `editor-scroll-debug.js` until the Phase-0 suite has been green on
  macOS + Windows for a full release cycle; then prune stale call sites.

## Verification strategy

- Unit: session-module tests (arbitration windows, anchor math);
  existing `scroll-state.test.js` / `translate-viewport.test.js` updated per
  phase; `editor-image-flow.test.js` viewport regression stays as the
  call-site sentinel until P5 removes the call site (then it asserts the
  default-safe path).
- Browser: Phase-0 suite runs in CI per phase (`npm run test:browser`).
- Manual: Windows scroll pass before each release that includes P3+ changes.
- Instrumentation: `writeScroll` refusals and anchor updates logged through
  `logEditorScrollDebug`, so field reports during migration are diagnosable.

## Open decisions (need sign-off)

1. `USER_SCROLL_PRIORITY_WINDOW_MS` — start 200ms; tune on macOS momentum
   scrolling and Windows wheel behavior.
2. P3 step 1: built-in virtualizer scroll adjustment vs. keeping anchor
   restores for resizes (pick one after measuring; do not ship both).
3. Whether AI translate-all / review-all progress renders (already partly on
   `translate-visible-rows`) migrate in P3 or stay as-is until P5.
4. Timing of the release checkpoints: P1+P2 can ship together in one release;
   P3 deserves its own release with Windows soak.

## Out of scope

- No framework change; vanilla ES modules and TanStack Virtual stay.
- The `innerHTML` window-rendering strategy stays (row patching is used for
  row-scoped changes only).
- Non-translate screens keep the simple raw scrollTop snapshot mechanism.
- Glossary/QA screens are unaffected (no virtualized editor); the parity rule
  does not apply — this is editor-only infrastructure.

## Sizing

~9–15 working days total across 5 phases, plus Windows verification and a
release-cycle bake before final deletion. P1+P2 (~4–5 days) deliver the two
biggest wins: guarantee 1 fixed globally and the forgotten-call-site bug
class cut off.

## Implementation log (2026-07-02, P0–P2)

### What shipped (local working tree)

**P0 — acceptance suite** in `tests/browser/editor-regression.spec.js`
(`test.describe("scroll guarantees")`): five tests pinning guarantees 1, 2
(glossary roundtrip + preview roundtrip), 3, and 5 (image delete). All green.
Harness fixes required to get there:

- The first-run telemetry disclosure modal opened during bootstrap in every
  browser test and intercepted pointer events — the whole browser suite had
  been silently red since the modal shipped. `mountEditorFixture` now
  dismisses it (`dismissTelemetryDisclosureModal`). Root cause is a
  browser-mode persistent-store key prefix mismatch (reads and writes use
  different localStorage keys), flagged as a separate task.
- The fixture never set an active storage login, so every login-scoped
  preference (editor location!) silently no-oped in tests.
  `applyEditorRegressionFixture` now calls `setActiveStorageLogin`.
- New fixture option `chapterStatus: "ready"` opts a test into
  editor-location persistence.
- The mock backend now serves `load_gtms_chapter_editor_data` from fixture
  state. Full cross-screen return via `[data-nav-target="translate"]` still
  dies in un-mocked team-access flows; the guarantee-2 glossary test re-mounts
  the fixture in-page instead (real persist + real restore path). Upgrade to
  full navigation in P4.

**P1 — `editor-scroll-session.js`** (single owner, arbitration):

- **Design revision: generation counter, not a time window.** The
  guarantee-1 test proved a `USER_SCROLL_PRIORITY_WINDOW_MS` cannot work: the
  queued-write restore fires long after the user stops scrolling and would
  still snap back. Instead, `noteUserScrollIntent()` bumps a generation;
  `captureTranslateViewport` stamps snapshots with it; restores from a stale
  generation are refused (`isUserScrollBasisCurrent`). Deliberate transitions
  pass `userIntent: true` (filter clear does). Open decision 1 is resolved —
  there is no window constant to tune.
- Intent capture (wheel / touchmove / scrollbar-gutter pointerdown /
  scroll keys) delegated in `translate-editor-dom-events.js`
  (`registerTranslateScrollIntentEvents`) — input events, never `scroll`
  events, which fire for programmatic writes too.
- Session anchor (chapter-scoped, survives controller remounts) updated on
  every scroll by both virtualization engines and after translate renders.

**P2 — default-safe renders:**

- `resolveTranslateRenderAnchor` (main.js) falls back to the session anchor,
  so every translate render is viewport-preserving even when the mutating
  call site captured nothing. Verified: with the image-delete fix reverted,
  the guarantee-5 test stays green pixel-perfect.
- `restoreTranslateViewport` is anchor-first: if the anchor element is
  mounted, aligning it IS the restore; raw scrollTop only applies when the
  anchor is unmounted (after-paint retries re-anchor later). Re-applying raw
  offsets after anchoring was itself a jump source.

### Findings that revise P3

- **Open decision 2 is resolved, with a twist.** virtual-core's built-in
  resize compensation was the actual mechanism of the reported image-delete
  jump: mutation-driven `resizeItem` calls shifted scrollTop, then anchor
  restores pinned the shifted position (−184px/+75px fight visible in the
  scroll-debug log). The fix is regime-gating, not either/or:
  `allowResizeScrollAdjustment` in `editor-virtual-list.js` enables the
  built-in adjustment only during scroll-driven window measurement (keeps
  upward scrolling smooth over estimated rows) and disables it during
  mutation/layout measurement, where anchor restoration owns compensation.
- **`shouldAdjustScrollPositionOnItemSizeChange` is an instance field, not an
  option.** Passing it through `setOptions` silently does nothing; it must be
  assigned on the `Virtualizer` instance.
- **Chromium native scroll anchoring is a fifth compensator.**
  `overflow-anchor: none` was Windows-only on `.translate-main-scroll`; it is
  now unconditional (WKWebView ignores it; WebView2 and the browser harness
  are Chromium). Watch Windows behavior at the next release anyway.

### Still open

- P3 (row-scoped mutations move to `translate-visible-rows` row patching),
  P4 (persistence + filter restore on the session anchor, full-navigation
  guarantee-2 test), P5 (delete the per-call-site snapshot threading and the
  parallel mechanisms).
- The pre-existing browser-suite failures unrelated to scroll predate this
  work — the suite was fully red before the telemetry-modal fix. Triage
  completed 2026-07-02: of the 29 failures on the current tree, 28 fail
  identically with all scroll changes stashed (AI-translate/assistant flows,
  glossary highlight flows, sync/refresh reload flows, dirty-row persistence
  family, footnote/history flows, upload-editor bottom-pin). The 29th
  (`typing in one row then focusing another row persists`, spec :4795) is a
  flaky detached-element race in `clickLocatorCenter` during the
  persist-triggered body remount (9/10 pass on the current tree) — the same
  race its sibling tests hit deterministically, and precisely the remount
  class P3's row patching removes. Zero regressions from P0–P2.

## Implementation log (2026-07-05, pre-existing failures + P3)

### Pre-existing browser-suite repair (commit 89b701bc)

Triage of the 29 failures confirmed all pre-existing (28 identical with
scroll changes stashed, 1 flaky helper race). Root causes were UI evolution
the dark suite never saw: the display-field refactor (tests clicked
always-mounted textareas), the assistant redesign (three-part thread keys,
`sourceLanguageCode` required on threads, Shift+Return send, AI-Assistant
default tab, translate buttons hidden for translated rows), structured
footnotes (`{marker, text}` arrays, inline ` [1]` markers), the tooltip
payload schema, and the refresh flow's reload-then-sync contract. Two real
bugs surfaced and were fixed:

1. **Deliberate jumps now advance the scroll-intent generation** (bottom
   pin, filter scroll-to-top, center-row) and virtualizer layout anchors
   carry/check the generation — a stale anchor restore was un-pinning the
   bottom pin.
2. **`setActiveEditorField` aborts superseded activations**: a slow row
   load completing after the user focused another text control no longer
   resurrects editing controls (logical focus descriptors, robust across
   remounts).

Harness: the mock serves `list_accessible_github_app_installations`
matching the fixture team (`github-app-installation-1`), unblocking
team-access refresh flows and the P4 full-navigation test.

### P3 — row-scoped mutations render via row patching (commit c5ece497 + this chunk)

`renderEditorRowScoped(render, rowIdOrIds, reason)` in
`editor-row-scoped-render.js` is the single primitive: it renders
`translate-visible-rows` patches (viewport preserved by construction — no
snapshot threading, no post-render restores) and falls back to a body
render **while filters are active**, because a row change can alter
filtered membership (reviewed / has-image / has-footnote / search text)
and a patch cannot add or remove row cards.

Migrated: all image operations; footnote open/entry/collapse; image-caption
open/collapse; marker toggle optimistic/saved/failed; text-style changes;
footnote-normalization saves; and **main-field activation/collapse** (the
biggest remount source — activation patches the new row plus the rows
losing open-editor/active state, and `renderTranslateVisibleRowsOnly` now
applies `restorePendingEditorSelection` so caret placement works through
patches). Kept on body renders: conflict resolution (always changes
has-conflict membership) and structural changes (insert/delete/merge,
filters, collapse, font size, chapter load).

Focus findings that the migration surfaced (both fixed):

- A patch-queued focusout collapse ran before the dismiss path's rAF
  refocus and closed the editor; the refocus is now synchronous when the
  replacement field exists, and the dismissing pointerdown prevents the
  default focus action (it would land on the detached node's container and
  re-blur).
- `clickLocatorCenter` in the browser harness read `boundingBox()`
  manually and raced row patches; it now uses `locator.click()` (centered
  by default, retries on detach). The historically flaky
  "typing in one row then focusing another row" test is 8/8 stable.

### Remaining before P4

- Windows soak of P3 before release (root AGENTS.md: virtualization scroll
  differs; also validates the unconditional `overflow-anchor: none`).
- Open decision 3 (AI translate-all/review-all render migration) deferred
  to P5 as allowed.

## Implementation log (2026-07-05, P4 + Windows CI)

### Windows soak substitute

`.github/workflows/browser-tests.yml` runs the full Playwright suite on
`ubuntu-latest` and `windows-latest` (push to main, ready PRs, dispatch).
First run green on both legs. This is the standing substitute for the manual
Windows soak (WebView2 is Chromium; the leg covers engine + Windows
compositor/fonts/scroll timing). Residual uncovered risk: OS scrollbar drags
and real wheel input — cover via a Windows-teammate canary before release.
The Ubuntu leg also closes the gap that let the suite rot unseen: it was
never in CI before.

### P4 — persistence and filters read the session anchor

- `persistEditorLocationForChapter` saves from `readSessionAnchor(chapterId)`
  (model-space, DOM-independent); the DOM scan remains only as a fallback
  before the session's first update. Successful entry restores seed the
  session anchor so default-safe renders anchor correctly before the first
  scroll event.
- Filter restore captures the session anchor first (same fallback rule).
- The guarantee-2 glossary roundtrip test now uses **real navigation**
  (`open-editor-glossary` click out, `[data-nav-target="translate"]` back),
  exercising team-access refresh, chapter reload, and location restore
  end-to-end against the mocks added during the test repair.
- Deliberately deferred to P5: deleting the `pendingRestoreSnapshot` /
  `restoredChapterId` entry-restore state machine and the filter viewport
  plumbing — the mechanisms still work, are generation-safe, and their
  removal belongs with the rest of P5's machinery deletion
  (`translate-viewport.js`, primed anchors, pending-anchor queue).
