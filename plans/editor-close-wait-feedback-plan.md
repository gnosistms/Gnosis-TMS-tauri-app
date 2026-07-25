# Editor Close Wait Feedback

## Problem

The translate-screen close guard blocks the window close while durable editor
writes are pending. Its only feedback is a one-shot notice badge, and its only
escape hatch is clicking close a second time (which force-closes and can lose
data). After an AI Translate All / Review All run, the repo write queue holds
several batched commits, so the blocked period lasts many seconds. Field report
(2026-07-25): users read the unresponsive close button as dead — and the
double-click escape hatch means the natural "click it again" reaction silently
risks data loss.

## Approach

When a close request is blocked, open a small modal that:

- says the app is saving changes before closing, with a live count and a
  progress bar as the queues drain;
- closes the app automatically once all pending writes finish (the user asked
  to close; finishing the close is the point);
- offers **Keep app open** (cancel the pending close; saves continue in the
  background) and **Close without saving** (the explicit force path, replacing
  the double-click escape hatch).

Repeated clicks on the native close button while the modal is open are
absorbed (the modal stays; nothing force-closes). The `beforeunload` fallback
(browser dev mode) is unchanged.

## Changes

1. `src-ui/app/state.js` — add `state.editorCloseWait`
   (`{ isOpen, pendingCount, initialCount }`) with factory + reset.
2. `src-ui/app/editor-persistence-flow.js` — extract the per-row pending-write
   predicate; add `countPendingEditorWriteRows()` alongside
   `hasPendingEditorWrites()`.
3. `src-ui/app/editor-close-wait-flow.js` (new) — wait-session controller
   (factory + default instance bound to real queues, injectable scheduler for
   tests). Polls every 250 ms while open; updates `state.editorCloseWait` and
   renders on count changes; when the injected `hasPendingDurableWrites()`
   goes false, closes the session and calls the injected `closeWindow()`.
   Exposes `beginEditorCloseWait`, `cancelEditorCloseWait`,
   `forceCloseEditorCloseWait`.
4. `src-ui/app/editor-close-guard.js` — drop the double-click force hatch and
   notice; the guard now only decides allow/block and invokes `onCloseBlocked`
   on every blocked request.
5. `src-ui/screens/editor-close-wait-modal.js` (new) — compact modal with
   count line, progress bar, and the two buttons.
6. `src-ui/styles/modals.css` — `editor-close-wait-modal__*` progress styles
   (mirrors the AI translate-all track/fill).
7. `src-ui/screens/translate.js` — append the modal to the translate modal
   chain.
8. `src-ui/app/actions/translate-actions.js` — handle
   `editor-close-wait-keep-open` and `editor-close-wait-force-close`.
9. `src-ui/main.js` — wire guard `onCloseBlocked` → `beginEditorCloseWait`
   with a `closeWindow({ force })` callback that sets
   `editorCloseForceApproved` on force and calls the Tauri window `close()`.
   The `onCloseRequested` handler returns early when force is approved.

## Notes

- "Pending changes" count = pending editor rows + active editor operations +
  active repo write queue operations. Components overlap slightly (a running
  row save is also a queue operation); the count is a progress signal, not a
  ledger, and completion is driven by the same `editorHasPendingDurableWrites`
  predicate the guard uses — so the modal can never auto-close while the guard
  would still block.
- Auto-close calls the normal window `close()`, so the guard re-evaluates; if
  new writes appeared in the gap, the modal simply reopens.
- The wait can include a running remote sync push (part of the guard
  predicate), which can be slow; the modal copy mentions syncing and the force
  button remains available.

## Tests

- Rewrite `editor-close-guard.test.js` for the simplified guard.
- New `editor-close-wait-flow.test.js` — begin/poll/auto-close/cancel/force
  with injected scheduler and predicates.
- New `editor-close-wait-modal.test.js` — markup for open/closed states,
  count text, progress width, buttons.

## Status

- [x] Implemented
- [x] `npm test` green
- [x] `npm run audit:unused` no regressions
