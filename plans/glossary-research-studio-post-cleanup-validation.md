# Build and validate pending Studio features after disk cleanup

## Request
After freeing sufficient disk space, build the current native app and test the
features implemented while the disk-space guard prevented native builds.

## Scope and sequence
1. Require the normal 30 GiB free-space guard to pass. Build artifacts were removed,
   but local Time Machine snapshots appear to retain their blocks. Snapshot
   thinning requires the outstanding user approval because it removes local
   restore points for other files as well.
2. Run the full frontend/workflow unit suite and the Studio browser regressions.
   Verify skip recommendations, visible step numbering/statuses, JSON Save dialog
   and shared tooltip, read-only step navigation, redo confirmation, dependent
   clearing, cancel behavior, and reopening. Provider calls use fixtures.
3. Run native Rust tests, including piecewise JSON export to a chosen path,
   evidence storage/cache preservation, dictionary cache, and Studio command/tool
   regressions. Fix relevant failures while preserving unrelated working changes.
4. Build a local debug app bundle from this checkout with bounded build parallelism
   and verify the actual native export/navigation behavior in the rebuilt app.
   Preserve real research checkpoints; do not incur paid research calls merely
   to test UI/storage mechanics. Keep old code and notes intact.
5. Record test/build results and any remaining limitations. Do not publish a release
   or overwrite a running app bundle while it is in use.

## Initial status
Build remains blocked at 13.5 GiB free against the normal 30 GiB minimum. The
previous cleanup left only the running app bundle in the Rust target directory.
Frontend checks can proceed while snapshot-cleanup approval is pending.

## Checks completed while native building remains blocked
- Full app unit suite: 2,511 passed.
- Workflow/launcher suite: 25 passed when rerun with the local socket access those
  server-based tests require. The first sandboxed attempt failed four launcher
  socket checks; no launcher code was changed to accommodate the sandbox.
- Frontend production build and focused Studio/translation-request ESLint passed.
- Rust formatting check passed after formatting one newly added test-import list
  in ai/mod.rs. This is formatting validation, not native compilation.
- Full Studio browser suite is recorded in
  /tmp/gnosis-post-cleanup-browser.log. Provider operations use fixtures.

Native tests, app bundling and native UI verification remain pending the normal
30 GiB free-space requirement. Snapshot thinning was not inferred from the request
to build after cleanup; explicit approval remains outstanding because local
restore points include historical versions of non-build files as well.
- Final Studio browser result: all 58 scenarios passed (1.6 minutes).

## Snapshot approval and native validation
User explicitly approved thinning local Time Machine snapshots. Requested 25 GiB
via tmutil; macOS removed four oldest local snapshots and free space increased to
39.2 GiB. Seven newer local snapshots remain. The normal build guard passes.

Starting native tests with two compiler jobs, incremental compilation disabled,
and development/test debug symbols omitted to limit cache growth and CPU load.
No build guard thresholds or source version checks were weakened. Native test log:
/tmp/gnosis-post-cleanup-native-tests.log.

Packaging preflight found the macOS Git runtime archive missing from the checkout
and old debug bundle. Restaged it from the installed Xcode Git runtime following
the repository's release workflow layout, preserving Apple's original executable
signatures. codesign verification succeeded (Apple Software Signing chain), and
the normal macOS Git runtime archive guard passes. No fallback or guard bypass was
introduced; the generated archive is a local packaging prerequisite.

Native library tests passed: 802 passed, 0 failed, 8 intentionally ignored. Cold
compilation took 4m17s; tests took 22.9s. The native chosen-path JSON export and
piecewise-evidence preservation regressions passed. No paid evaluations ran.

Building the native debug app with the normal guards, two compiler jobs, no
incremental cache or debug symbols, locked/offline Cargo dependencies, and local
bundling only. The temporary bundle override disables generation of updater
release artifacts; it does not change updater verification in the app. The idle
old development instance was closed through its UI before replacing its bundle.
Build log: /tmp/gnosis-post-cleanup-native-build.log.

## Native bundle and UI smoke test
- Native debug app build/bundling succeeded. The app reports version/build 0.8.125
  and includes the bundled Apple Git archive. Native compilation after the test
  build took 1m35s. No release was published.
- Opened the rebuilt bundle by its exact path, restored the existing login, and
  opened Test team 32's saved ilustre study through the app UI.
- Verified clickable outline navigation, preserved completed/skipped/stale labels,
  visible 4.4.3 numbering, step-6 collapsed meaning/candidate lists, and the exact
  redo modal. Cancel restored the original note.
- Verified the actual native Save dialog and cancellation. The on-disk study was
  exactly identical to its pre-test snapshot after browsing + both cancellations
  (revision remained 175).
- Saved a real export to /tmp/gnosis-studio-native-export.json through that dialog.
  It contains 57 complete paragraphs and 57 assignments, 4 stored candidate
  records, 4,778,131 bytes and zero unresolved artifact descriptors. All compared
  research fields and step statuses are unchanged, and export data matches the
  saved checkpoint. Report: /tmp/gnosis-native-research-smoke-result.json.
- The destructive Continue branch was verified using disposable browser fixtures
  and workflow tests; the real saved research was preserved.
- Tauri's local bundle contained a valid linker-signed executable but no resource
  seal. Applying a local ad-hoc development bundle signature before final reopen;
  this is a local debug app, not a notarized published release.

## Final verification
- The local ad-hoc bundle signature now seals Info.plist and resources; deep strict
  codesign verification passes. Reopened the final signed bundle successfully.
- No new research tool-cache entries were created by the native smoke test.
- Final normal build guard passes: approximately 35.8 GiB free, 2.6 GiB Rust cache.
- Rust formatting and diff whitespace checks pass after packaging.
- Completed: 2,511 app unit tests, 25 workflow tests, 58 Studio browser scenarios,
  802 native tests (8 intentionally ignored), frontend build, native app bundle,
  and native UI/storage smoke tests. No paid AI calls were made.
- The rebuilt app is left open on the preserved ilustre study at step 10b.
