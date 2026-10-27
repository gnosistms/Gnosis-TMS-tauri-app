# Release 0.8.128

1. Prepare the next patch from main, including subtitle alignment and the source
   glossary footnote fix. Preserve the original development checkout.
2. Synchronize package, Tauri, Cargo and lockfile versions; regenerate notices
   and write user-facing release notes.
3. Validate metadata, locked dependencies, workflow tests and production build;
   open and merge a focused release PR.
4. Push annotated tag v0.8.128 at the release merge commit. Verify the existing
   signed release workflow, platform assets, notes, and updater manifest.

Publish on GitHub only; leave local app installation to the user.

## Validation

All six version files agree on 0.8.128. Locked Cargo metadata, the development
version guard, all 25 workflow tests, and the production frontend build passed.
The notices generator changed only the app version. The included subtitle code
previously passed 2,937 frontend tests, 885 Rust tests, strict Clippy, and both
Linux/Windows browser suites.
