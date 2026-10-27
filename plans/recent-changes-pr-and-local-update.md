# Recent changes PR and GitHub app release

1. Inventory the dirty working checkout and upstream history. Preserve existing
   working changes; assemble genuinely unmerged work on a fresh codex branch.
2. Validate, open, and merge the application PR after its checks pass.
3. Publish the next patch through the normal GitHub release workflow. The user
   will install the update themselves; do not replace the local app bundle.
4. Verify release assets, versioned notes, updater metadata, and the Mac package.

## Status

- PR #359 merged into main as 342a0eeaae28b463bfcc32e1f32fd05c07f5095b.
- Validation for #359: 2,904 frontend tests, 852 backend tests (8 existing ignored),
  25 workflow tests, strict Clippy, formatting, build, and Linux/Windows browser
  suites passed.
- The user's reported dev Git failure came from one app version pruning another
  version's hash-keyed runtime. Restored the missing runtime from its own archive;
  the exact project rev-parse command succeeded. Applied the focused source fix
  and regression tests to the original dev checkout, preserving other changes.
- PR #360 merged as 2a70d03919820e59ee7a5cd97e304abbe61374c8. Version metadata and
  release notes are synchronized at 0.8.127. All required checks passed, including
  the Windows retry. Its first attempt hit ERR_NO_BUFFER_SPACE before a fixture
  loaded; the same source passed on the fresh runner.
- The three new runtime tests failed before the fix and pass after it. Mac backend:
  855 passed, 8 ignored. Linux backend: 850 passed, 7 ignored. Strict Clippy and
  all 25 workflow tests pass.
- Annotated tag v0.8.127 is pushed on the release merge commit. Signed build run:
  https://github.com/gnosistms/Gnosis-TMS-tauri-app/actions/runs/39733017364
- Release complete: all three platform jobs and versioned notes publication
  succeeded. Version 0.8.127 is the latest GitHub release, with 13 uploaded assets.
  All seven updater platform entries resolve to the correct packages; all four
  unique package signatures match their published signature assets.
- The downloaded Apple Silicon app passed Developer ID signature, version, and
  bundled Git signature checks. Its Git version is 2.50.1 (Apple Git-155); the dev
  bundle uses 2.54.0 (Apple Git-157).
- Local installation is left to the user. The installed app bundle was never
  replaced; cancelled installer files and verification-only app copies were
  removed. Other original working changes remain intact.
