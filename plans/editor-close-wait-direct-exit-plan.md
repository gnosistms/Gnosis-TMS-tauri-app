# Editor Close Wait: Quit Without Closing the Window

## Problem

Field report (2026-11-03): after an accidental Cmd+W with unsaved editor
changes, the "Saving changes before closing" dialog appears and the app
freezes. Neither button responds.

The macOS unified log for both freezes that day (15:15:51 and 15:37:30)
shows the same sequence:

1. `windowShouldClose: prevented close` (the close guard blocked the close).
2. About a second later, IPC requests from the page keep starting
   (`WebURLSchemeTaskProxy::startLoading`) but none ever completes, and the
   app's main thread logs nothing more until the process is killed.

The frozen window was still on screen but drawn as non-key (grey traffic
lights), the state AppKit leaves a window in partway through
`-[NSWindow close]`. The freeze lines up with the close wait's auto-close:
once the pending writes drain, the poll calls `closeWindow()`, which destroys
the Tauri window. The editor scroll debug log shows no render after the
dialog opened, so no click reached the page.

A normal close with nothing pending also destroys the window, from inside
Tauri's own close-request handler, and works (2026-11-02 19:18:00). A minimal
Tauri 2.10.3 app that destroys its window a second after a prevented close,
with many IPC requests in flight, also closes cleanly. So the hang needs
something in this app's state at teardown that has not been pinned down:
`sample` cannot attach to the hardened release build without root. The one
step common to every candidate is tearing the window down.

## Approach

When the close wait finishes (writes saved, or **Close without saving**),
quit the process directly from the backend instead of destroying the window:

- New sync command `exit_app_after_close_wait` (runs on the main thread):
  save the `app-state.json` store (standing in for the store plugin's exit
  hook, which this path skips), call `cleanup_before_exit`, then
  `std::process::exit(0)`. No window close, no webview teardown.
- `app-window-close.js` gains `exitAppAfterCloseWait()`, which invokes the
  command and falls back to destroying the window if the command is
  unavailable.
- `main.js` `closeAppWindow` uses it for both the auto-close and the force
  path. The ordinary unguarded close (Tauri's own `destroy()` when nothing is
  pending) is unchanged.

Skipped by the direct exit: the shell plugin's exit hook that kills a
running typst sidecar. That only matters if a PDF export is mid-run, and
typst finishes on its own.

## Tests

- `app-window-close.test.js`: the exit helper invokes the command; falls back
  to destroy when the command fails or Tauri is absent.
- `tests/browser/editor-close-wait.spec.js` (new): with a mocked native side,
  Keep app open dismisses the dialog; Close without saving and the auto-close
  after a save finishes both quit through `exit_app_after_close_wait` and never
  call `destroy()`.
- `cargo check` for the new command.

## Status

- [x] Implemented
- [x] `npm test` green
- [x] Browser spec green (the two quit tests fail against the old destroy path)
- [x] `cargo check` green
- [ ] Verified in the packaged app (needs a release build; the freeze could
      not be reproduced outside Hans's real session)
