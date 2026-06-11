# Editor close guard: visible feedback + "close anyway" escape hatch

## Problem

`registerTauriEditorCloseGuard` in `src-ui/main.js` prevents the Tauri window close
while `editorHasPendingDurableWrites()` is true (translate screen with dirty rows,
active editor operations, active local repo writes, or running remote sync). The
prevented close is silent — no notice, no escape hatch — so a wedged repo-write-queue
operation (see `plans/repo-write-queue-stuck-state-handoff.md`) blocks closing forever
with no feedback.

## Approach

1. **New module `src-ui/app/editor-close-guard.js`** — pure decision logic, factory
   style like `editor-navigation-guards.js`, with an injectable clock so tests are
   deterministic:
   - `createEditorCloseGuard({ hasPendingDurableWrites, showBlockedNotice, now })`
     returning `{ handleCloseRequest() }`.
   - First close attempt while writes are pending: block, show a notice via the
     injected callback ("Editor changes are still saving… Close again to close
     anyway — unsaved changes may be lost.").
   - Second close attempt at least `REPEAT_MIN_DELAY_MS` (1 s, guards against an
     accidental double Cmd+W) and at most `REPEAT_WINDOW_MS` (30 s) after the first
     blocked attempt: allow the close (`forced: true`). The guard never fakes save
     success — it only stops preventing the close; pending operations stay pending,
     per the product decision in the stuck-state handoff doc.
   - An attempt after the window expires counts as a fresh first attempt (re-block,
     re-notice) so a stale blocked attempt from minutes ago cannot silently arm a
     force close.
   - Once writes drain, any close attempt allows the close and resets the armed state.

2. **Wire into `src-ui/main.js`**:
   - Notice via the existing `showNoticeBadge(text, render, durationMs)` badge path
     (already rendered on the translate screen via `getNoticeBadgeText()`).
   - `onCloseRequested` delegates to the guard; `event.preventDefault()` only when the
     guard blocks. A forced allow sets a flag the `beforeunload` handler checks so it
     does not re-block a user-approved force close.

3. **Tests `src-ui/app/editor-close-guard.test.js`** — node:test + assert/strict like
   `editor-navigation-guards.test.js`; injected `now`.

## Files

- `src-ui/app/editor-close-guard.js` (new)
- `src-ui/app/editor-close-guard.test.js` (new)
- `src-ui/main.js` (rewire `beforeunload` + `registerTauriEditorCloseGuard`)

## Out of scope

- Fixing the underlying stuck repo-write-queue mechanism (separate handoff brief).
- Telemetry on forced closes (possible follow-up; would route through
  `reportBackendNonfatalError`).
