# Release 0.8.132

1. Prepare a patch release from main after PRs #371–#373. Synchronize the npm,
   Tauri, Cargo, lockfile, and bundled notice versions; add release notes.
2. Validate version agreement, locked Cargo metadata, workflow tests, and the
   production frontend build. Publish and merge a focused release PR.
3. Push annotated tag v0.8.132 at the release merge commit. Verify the signed
   macOS Apple Silicon, macOS Intel, and Windows build jobs, release notes,
   downloadable assets, and updater manifest.

Publish the app update on GitHub; leave local installation to the user.

The application changes passed full frontend/native validation and the
Linux/Windows browser matrix in PR #373. The final reconciliation with PR #372
changed only its completed plan document.

## Validation

- All six manifest/lockfile version fields agree on 0.8.132.
- Locked offline Cargo metadata and the development version guard pass.
- All 25 workflow tests and the production frontend build pass.
- Regenerated third-party notices differ only by the application version.
