# Release 0.8.84

Date: 2026-08-03

## Contents

- Resolve WordPress image captions when uploaded filenames exceed the media API's
  practical search length (#238).
- Export WordPress posts from the latest saved editor snapshot so background
  refreshes cannot publish stale content (#239).
- Preserve and resolve WordPress media attachment IDs so exported images receive
  responsive `srcset` markup and remain sharp on Retina displays (#240).

## Steps

- [x] Audit the release contents and open pull requests.
- [x] Bump version to 0.8.84 in package.json, package-lock.json, Cargo.toml,
      Cargo.lock, and tauri.conf.json.
- [x] Run pre-tag verification: JavaScript and workflow tests, JavaScript lint,
      frontend build, Cargo formatting, Rust tests, version consistency, and
      `git diff --check`.
- [ ] Merge the release PR.
- [ ] Tag `v0.8.84` and push the tag.
- [ ] Confirm the release workflow succeeds on macOS arm64, macOS x64, and Windows
      x64, and verify the published GitHub Release assets and updater metadata.

## Pre-tag verification

- JavaScript: 1,883 tests passed; 5 workflow tests passed.
- Browser: 124 tests passed; 1 performance probe skipped.
- Rust: 551 tests passed; 1 pasteboard smoke test ignored.
- Frontend production build completed successfully.
- Cargo formatting and release-version consistency checks passed.
- ESLint completed with no errors and 67 existing warnings.
- The unused-code audit reports the known baseline file
  `scripts/bench-ai-translate.mjs` and no additional findings.
- `git diff --check` passed.

## Release verification

Pending.
