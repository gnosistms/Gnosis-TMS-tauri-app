# Release 0.8.88

Date: 2026-08-06

## Contents

- Serialize footnotes consistently for history and review comparisons (#254).
- Remove the legacy glossary matcher scan now that coordinated global matching
  is fully active (#255).
- Consolidate the derived glossary term input builder (#256).
- Render footnote markers once when split by search highlights (#257).
- Number preview caption search matches per logical match, so marks, the
  "n of m" counter, and navigation agree when a caption match spans an inline
  style boundary (#258).

## Steps

- [x] Audit the release contents and open pull requests.
- [x] Bump version to 0.8.88 in package.json, package-lock.json, Cargo.toml,
      Cargo.lock, and tauri.conf.json.
- [x] Run pre-tag verification: JavaScript and workflow tests, JavaScript lint,
      frontend build, and `git diff --check`.
- [x] Merge the release PR.
- [x] Tag `v0.8.88` and push the tag.
- [x] Confirm the release workflow succeeds on macOS arm64, macOS x64, and Windows
      x64, and verify the published GitHub Release assets and updater metadata.

## Pre-tag verification

- JavaScript: 1,931 tests passed; 9 workflow tests passed.
- ESLint completed with no errors and 66 existing warnings.
- Frontend production build completed successfully.
- `git diff --check` passed.
- The only Rust change since v0.8.87 is the legacy glossary matcher scan
  removal (#255), which passed Rust quality checks and strict Clippy on its
  own PR; the release PR's clean GitHub runner revalidates Rust tests.

## Release verification

- Release workflow run 31141042468 succeeded on macOS arm64, macOS x64, and
  Windows x64. The first Windows attempt failed with a transient bundler
  download error (`failed to bundle project: http status: 500`) and succeeded
  on rerun; both macOS builds passed on the first attempt.
- GitHub Release `v0.8.88` is published as the latest stable release with both
  macOS DMGs and updater archives, Windows MSI and NSIS installers, signatures,
  and `latest.json`.
- `latest.json` reports version 0.8.88 for darwin-aarch64, darwin-x86_64, and
  windows-x86_64 (app, MSI, and NSIS variants).
