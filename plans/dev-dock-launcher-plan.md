# Development Dock launcher

1. Add a macOS installer that creates a Gnosis TMS Dev AppleScript app using the existing icon.
2. Launch `npm run tauri:dev` from this checkout in a named Terminal session; reuse that session while busy.
3. Install in the user's Applications folder and verify the launcher.

## Updated request

- Generate a distinct gold-and-brown developer icon inspired by the main app.
- Save PNG and ICNS assets under scripts/assets and use them in the installer.
- Remove only this launcher's permanent Dock entry; future installs must not pin it.

## Shutdown repair

1. Supervise the shortcut's dev command in its own process group and clean up that group on exit, interrupt, or Terminal hangup.
2. Enable Tauri's exit-on-panic option while retaining development file watching.
3. Verify normal exit, command failure, and interruption with a real child server; clear the identified old session and check port 1431 is available.

Verified: four process lifecycle tests pass (normal exit, failure, SIGINT, SIGHUP), including cleanup of a grandchild server that ignores SIGTERM. The real shortcut started Vite and the native dev command; terminating the supervisor released port 1431. The old session was stopped. A manual window-close check remains unverified; concurrent Rust edits triggered rebuilding during the live check.
