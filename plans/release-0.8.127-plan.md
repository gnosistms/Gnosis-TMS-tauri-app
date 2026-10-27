# Release 0.8.127

1. Prepare the next patch release from main after PR #359, preserving the original
   development checkout and leaving the user's local app installation to the user.
2. Synchronize package, Tauri, Cargo, lockfiles, and bundled-notices versions and
   add user-facing release notes for PDF font fallback, session recovery, preview
   navigation, linked descriptions, footnote styling, and research improvements.
3. Verify release metadata, locked dependencies, workflow tests, build, and diff;
   open and merge a release PR after required checks pass.
4. Push annotated tag v0.8.127 on the release merge commit. Monitor the existing
   GitHub release workflow, then verify Mac and Windows assets and updater metadata.

The user clarified that updating the app means publishing on GitHub; they will
handle installation on their own computer. Do not replace the local app bundle.

## macOS runtime regression discovered before publication

- Starting a second app version pruned the first version's hash-keyed Git runtime,
  leaving its cached executable path missing. Preserve other versions' runtime
  directories on both extraction and cached startup; each process owns its own
  temporary extraction directory.
- Add backend regression tests for two different archives, reuse of an existing
  runtime, and preservation of another process's extraction directory.
- Restore the missing runtime from the dev build's own archive to recover the
  running development session without changing its projects or installed app.

## Validation

- All three runtime regression tests failed before the fix. With the fix, the
  macOS backend suite passed: 855 tests, 8 existing ignored tests.
- The regression tests also compile and run in the Linux quality workflow.
- All 25 workflow tests passed; release version guard and locked Cargo metadata
  passed; production frontend build passed.
- The original installed app was not replaced. The dev runtime repair passed
  Git --version and rev-parse --git-dir for the project in the error report.
