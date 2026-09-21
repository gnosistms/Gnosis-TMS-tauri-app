# Clear update notices after the advertised version is installed

## Findings

- Native checks report the running package version and only offer newer versions.
- The frontend persists update notices across restarts. Its installed-version
  check currently refuses to clear them when the server returns a platform
  availability message or offers a newer release. Neither condition means the
  previously advertised version is still missing.
- The published v0.8.118 manifest advertises v0.8.118 platform assets consistently.
  The reporter subsequently identified macOS, a displayed current version of
  0.8.116, and an attempted 0.8.117 update with a platform-unavailable error.
- The v0.8.117 manifest currently contains both macOS architectures. Its Apple
  Silicon archive was uploaded at 05:24 UTC and Intel archive at 05:29 UTC on
  September 21. Releases publish before all matrix builds finish, so temporary
  platform-unavailable results are possible. The dialog's currentVersion is also
  persisted, so its 0.8.116 label alone does not establish the running binary.
  This patch fixes reproduced stale-notice paths; the reporter's exact install
  sequence has not been reproduced on her machine.

## Plan

1. Reproduce stale optional/required notices after restart with native check
   responses containing a platform message or a newer available version.
2. Reconcile the saved notice using the running version independently of remote
   availability. Preserve notices when the installed version is older or unknown.
3. Run updater regression tests and relevant frontend checks; record results.

## Follow-up: platform availability must precede the app-wide requirement

The repository version guard currently escalates a sync requirement directly to
an app-wide non-dismissible prompt. That is invalid during partial releases or
when the required build cannot be fetched for this platform.

1. Keep the repository's minimum version separate from a verified installable
   update. Check the native updater for that minimum before enabling the global
   required prompt. Preserve the backend's resource sync/data-format guard.
2. Revalidate persisted requirements at startup; never restore an unverified
   global lock. Missing platform builds and check/download failures must leave
   other actions usable. Background rechecks can offer the update when ready.
3. Pass the minimum version into the existing native resolver under its check
   timeout. Keep project/glossary/QA behavior consistent through the shared flow.
4. Add regressions for partial releases, failed checks/downloads, cache hydration,
   and eventual availability; run frontend and focused native validation.

## Validation

- Three new restart regressions failed before the fix and pass after it: optional
  and required notices with a platform message, and a satisfied required notice
  with a genuinely newer release available. The latter also verifies that the
  download requests the new release rather than the old saved version.
- All 2,235 frontend tests pass; focused updater/modal tests: 32 passed.
- ESLint for both changed JS files and `git diff --check` pass.
- `npm test` workflow stage initially failed four unrelated launcher tests because
  their temporary local server could not start in the sandbox; all four passed
  when rerun separately with local server access. The other 19 workflow tests
  passed in the original run.
- Unused-code audit reports three unused scripts, five browser-test imports,
  and one editor-footnote export, all outside these changes. No exports/imports
  were added or removed by this fix.

## Follow-up implementation and validation

- `requirement` records the repository minimum separately from `required`, which
  is now true only after native confirmation of an available compatible update.
  The native check uses the same minimum-version resolver as installation.
- Hydration migrates legacy required notices to unlocked pending requirements.
  Missing builds and failed checks/downloads/install attempts release the global
  lock. Hourly/manual checks can activate the prompt once the platform is ready.
- The strongest repository requirement is retained across concurrent sync
  reports; stale checks cannot replace a newer requirement. The actual available
  release is used for downloads, even when newer than the repository minimum.
- Backend repository sync guards remain intact. Project, glossary, and QA tests
  confirm failed sync stays paused while platform availability controls the UI.
- All 2,245 frontend tests, four Playwright updater tests, and 14 Rust updater
  tests pass. All 23 workflow tests pass with local-server access (the sandboxed
  run fails the four launcher tests because they bind temporary local ports).
- Changed updater/test JS passes ESLint. The state module retains its existing
  unused `normalizeEditorMode` warning. Rust formatting and diff checks pass.
  The unused-code audit retains its prior findings; the new version-comparison
  export is used by the updater flow.
- No release was published and no version was bumped.
