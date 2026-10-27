# Release 0.8.133

1. Prepare a patch release from main after PR #375. Synchronize npm, Tauri,
   Cargo, lockfile, and bundled notice versions; add release notes for preserved
   editor access and individual footnote focus.
2. Validate version agreement, locked Cargo metadata, the development version
   guard, workflow tests, notices, and the production frontend build. Publish
   and merge a focused release PR after its quality checks pass.
3. Push annotated tag v0.8.133 at the release merge commit. Verify the signed
   macOS Apple Silicon, macOS Intel, and Windows jobs, published release notes,
   downloadable assets, and updater manifest.

The application changes passed all frontend and native quality checks and the
full Linux/Windows browser matrix in PR #375. This release changes metadata and
documentation only.

Publish the app update on GitHub; leave local installation to the user.

## Validation

- All six manifest/lockfile version fields agree on 0.8.133.
- Locked offline Cargo metadata and the development version guard pass.
- All 25 workflow tests pass outside the process-restricted sandbox; the initial
  sandbox run could not start child servers in four launcher tests.
- The production frontend build passes.
- Regenerated third-party notices differ only by the application version after
  preserving the repository's LF line endings.
- The Git diff has no whitespace errors.
