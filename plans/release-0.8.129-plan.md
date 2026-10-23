# Release 0.8.129

1. Prepare the next patch release from main after sentence grouping PR #364.
   Preserve the original development checkout and its unrelated local work.
2. Synchronize package, Tauri, Cargo and lockfile versions; regenerate notices
   and write release notes for sentence grouping and editor improvements.
3. Validate release metadata, locked dependencies, workflow tests and production
   build; open and merge a focused release PR after its required checks pass.
4. Push annotated tag v0.8.129 at the release merge commit. Verify the signed
   macOS and Windows release jobs, assets, release notes and updater manifest.

Publish on GitHub only; leave local app installation to the user.

## Validation

All six manifest/lockfile version fields agree on 0.8.129. Locked offline Cargo
metadata, the development version guard, all 25 workflow tests and the production
frontend build passed. Regenerated notices changed only the app version. The
feature release contents passed the full frontend/native suites and Linux/Windows
browser CI in PR #364.
