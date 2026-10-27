# Release 0.8.134

1. Prepare a patch release from main after PR #379. Synchronize npm, Tauri,
   Cargo, lockfile, and bundled notice versions; add notes for project book
   export, shared tooltips, loading feedback, and the glossary icon adjustment.
2. Validate version agreement, locked Cargo metadata, the development version
   guard, workflow tests, notices, and the production frontend build. Publish
   and merge a focused release PR after its quality checks pass.
3. Push annotated tag v0.8.134 at the release merge commit. Verify the signed
   macOS Apple Silicon, macOS Intel, and Windows jobs, published release notes,
   downloadable assets, and updater manifest.

PR #379 passed the full frontend/native quality checks and Linux/Windows browser
matrix. This release changes metadata and documentation only. Unrelated local
work is excluded by using a clean worktree based on main.

Publish the app update on GitHub; leave local installation to the user.

## Validation

- All six manifest/lockfile version fields agree on 0.8.134.
- Locked offline Cargo metadata and the development version guard pass.
- All 25 workflow tests and the production frontend build pass.
- Regenerated third-party notices differ only by the application version after
  preserving the repository's LF line endings.
- The Git diff has no whitespace errors.
