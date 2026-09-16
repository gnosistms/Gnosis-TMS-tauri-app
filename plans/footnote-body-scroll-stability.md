# Footnote-to-body editing scroll stability

## Problem

Clicking the body of a row while editing its footnote saves/closes the footnote
and opens the body editor, but can move the scrolled viewport.

## Plan

1. Reproduce the transition in the browser fixture at a nonzero scroll position,
   checking both focus and scroll through the transition.
2. Fix the responsible focus/render interaction within the existing row-scoped
   rendering and scroll ownership rules; preserve unrelated working changes.
3. Run the focused browser regression and relevant editor tests. Record platform
   limits; native Windows validation remains required for editor scroll behavior.

## Investigation — 2026-09-16

Initial status: not reproduced without a filter; see confirmed reproduction below.

- User confirmed macOS and longer text, then reported that the same steps no
  longer reproduced the jump. The initial steps may require another condition.
- Tested the running native Gnosis TMS app on HNHH chapter 05, switching between
  its long Vietnamese body and long footnote. The viewport stayed in place both
  with the body fully visible and with most of it above the viewport. No text
  changes were made to the user's chapter.
- Native scroll logs recorded the footnote-collapse and main-field-activate
  sequences at unchanged scroll offsets (including 12681 and 12915). The recent
  rotated log did not reveal a jump in the inspected collapse sequences either.
- Exploratory Chrome fixture tests passed for short text with 18 rows and with
  80 virtualized rows. This does not establish the behavior of the native WebKit
  app. Later long-text/WebKit experiments were not validated and were not retained
  as regression tests.
- Existing uncommitted work was preserved. No scroll/focus implementation change
  is justified by the evidence collected so far.

## Next reproduction

Capture the approximate time, chapter/row, whether the footnote text changed,
active filter, and whether scrolling was still settling immediately before the
click. Correlate the event with the existing native `editor-scroll-debug.jsonl`
log before proposing a fix. Windows remains untested.

## Confirmed reproduction and implementation

The user identified the missing condition: **Has glossary error** is active.
Reproduced in the native macOS app: closing the focused footnote and opening the
body moves the viewport back by roughly a row. Filtered edits use a body render;
the focused textarea anchor disappears, and the fallback row card incorrectly
inherits the textarea's offset.

1. Preserve the row's own viewport offset when capturing a field anchor, and use
   that offset if restoration must fall back to the row card.
2. Cover missing-control fallback in unit tests and the filtered footnote/body
   transition in a browser regression, including saved text and retained focus.
3. Validate with focused tests and macOS WebKit; native Windows remains untested.

## Result

Implemented in `scroll-state.js`: field snapshots retain `rowOffsetTop`, including
when queued across a body render. If the field disappears, the row fallback uses
that row offset. A surviving field continues to use its own offset.

- Reproduced the original behavior in the running native macOS app.
- Before the fix, the new macOS WebKit regression measured a 464 px jump.
- After the fix, all three focused WebKit tests pass: filtered footnote-to-body
  transition (including persisted edited text), ordinary body blur, and referenced
  empty-footnote save/reopen.
- All 2,174 frontend tests and 23 workflow tests pass. Workflow tests required
  the available fallback Git and execution outside the sandbox because system
  Git is blocked by the unaccepted Xcode license and launcher tests need sockets.
- Changed JS files pass ESLint; `git diff --check` passes.
- Unused-code audit reports unrelated files/imports and the existing
  `ensureEditorFootnoteEntry` export; this fix adds no exports or dependencies.
- The installed native app was used to reproduce, not rebuilt or replaced.
  Post-fix verification used macOS WebKit. Windows remains untested.
