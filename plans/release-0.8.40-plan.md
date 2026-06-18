# Release 0.8.40

Patch release after `v0.8.39`. Re-release of the 0.8.39 content with the
Windows release-build fix.

## Why 0.8.40 (and not a 0.8.39 re-tag)

`v0.8.39` published macOS artifacts (and the updater `latest.json`) but the
Windows job failed in the THIRD-PARTY-NOTICES generation: cargo-about
synthesized a license for the app crate (`gnosis-tms`, no `license` field) by
scanning the crate directory, which on the Windows runner contains the bundled
Git-for-Windows license files (deprecated `GPL-2.0`, curl, …). Since macOS
0.8.39 was already public, we ship a complete 0.8.40 rather than reuse the tag.

## Included since 0.8.39

- Fix: cargo-about now ignores private (`publish = false`) crates, so the app
  crate is no longer synthesized/scanned — unblocks the Windows release build.
- (Carries the 0.8.39 content: glossary/QA import fix #136, license compliance
  #137.)

## Pre-tag verification

- npm test, npm run audit:unused, cargo fmt --check, npm run test:rust (run for
  0.8.39; only about.toml + regenerated notices changed since).
- cargo about generate succeeds locally and no longer references gnosis-tms.

## Steps

1. Fix about.toml; regenerate THIRD-PARTY-NOTICES.md.
2. Bump version to 0.8.40 across the 5 release files.
3. Commit "Release 0.8.40", tag v0.8.40, push main + tag.
4. Watch release-tauri.yml — confirm Windows + both macOS targets publish.
5. Delete the partial v0.8.39 release once v0.8.40 is the published latest.
