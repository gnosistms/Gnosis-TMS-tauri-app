# Reconcile already-installed updates before offering or downloading them

The 0.8.136 updater error screenshot says macOS is unavailable, but the installed
app and live manifest both contain 0.8.136. The running app restarted at 10:02:22,
after the 10:01:32 screenshot. The preceding IPC/network timeline is not retained
in local updater logs, so do not claim that a historical request was reproduced.

Confirmed code paths to reproduce:
- A request for an already-running version gets no newer update from Tauri.
  The required-version resolver eventually mislabels this as missing macOS assets.
- Persisted optional update availability restores its old currentVersion and
  remains actionable while the startup check is pending.

1. Reproduce native already-installed classification and cached-prompt behavior.
2. Reconcile persisted availability against the running frontend build version.
   Handle a native already-installed download outcome explicitly and clear stale
   prompt/requirement state without pretending that an installer was downloaded.
3. Short-circuit native checks/downloads when the requested version is already
   satisfied. Preserve genuine missing-platform, newer-version, download, and
   restart behavior.
4. Run native and frontend regressions, lint/build/format checks, and record what
   is proven versus what remains unknown about the screenshot's first attempt.

## Evidence and completed fix

- The installed 0.8.136 app directory was created at 10:00:35 and its executable
  replaced at that time, before the 10:01:32 screenshot. The user could not recall
  the restart timing. The current process started at 10:02:22 and the persisted
  update record has since cleared. Historical updater IPC/HTTP responses are not
  retained, so the exact original request sequence remains unproven.
- Reproduced six failing frontend cases before the fix. Optional cached offers
  remain available during the startup check; clicking one supersedes that check,
  so its fresh currentVersion cannot reconcile the stale screen. A native lookup
  for an already-running requested version gets no newer candidate and falls
  through to the misleading required-platform error.
- Cache hydration now compares the offer and any repository requirement against
  Vite's bundled running version before restoring availability. Native checks
  and downloads short-circuit satisfied requests. Downloads explicitly return
  `alreadyInstalled` with the authoritative currentVersion, and the frontend
  clears stale prompts without claiming a download or requesting a restart.
- Preserve genuinely newer offline offers, newer repository requirements arriving
  during a download, and normal download/restart behavior. A late superseded
  startup check cannot reintroduce the stale message.
- Validation: 16 native updater tests, 46 focused frontend tests, and six WebKit
  updater browser tests passed. The full frontend run passed 3,192 app/screen
  tests and 25 workflow tests; the final additional startup-race test also passes
  in the focused suite. Build, targeted ESLint, strict all-target native Clippy,
  scoped Rust formatting, and whitespace checks passed. The unused audit was
  rerun; this fix adds no JavaScript exports or production modules.

This PR does not change the app version or republish the 0.8.136 release.

## PR verification on current main

- Branch based on `692fb6cf` (0.8.136 release merge).
- All 3,221 frontend tests and 25 workflow tests pass.
- All 16 native updater tests and 46 focused frontend tests pass.
- All six updater browser regressions pass in WebKit.
- Strict all-target Clippy, full JavaScript lint (no errors), production build,
  Rust formatting, and whitespace checks pass.
- Unused audit output exactly matches the existing main baseline.
