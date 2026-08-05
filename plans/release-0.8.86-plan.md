# Release 0.8.86

Date: 2026-08-04

## Contents

- Allow owners and admins to permanently delete soft-deleted glossaries and QA
  lists without the read-only state blocking the confirmation action (#246).
- Protect Rust build caches that back running binaries while cleaning abandoned
  worktrees and build artifacts (#247).
- Preserve BCP 47 script subtags such as `zh-Hant` when importing glossary and
  QA-list TMX files (#248).
- Improve WordPress post lookup with Unicode-aware, case-insensitive matching and
  relevance ordering (#249).
- Preserve footnote markers throughout AI review requests and responses (#250).
- Enable the coordinated globally longest glossary-matching policy in the
  frontend and Rust backend (#251).

## Steps

- [x] Audit the release contents and open pull requests.
- [x] Bump version to 0.8.86 in package.json, package-lock.json, Cargo.toml,
      Cargo.lock, and tauri.conf.json.
- [x] Run pre-tag verification: JavaScript and workflow tests, JavaScript lint,
      frontend build, Cargo formatting, Rust tests, version consistency, and
      `git diff --check`.
- [x] Merge the release PR.
- [x] Tag `v0.8.86` and push the tag.
- [x] Confirm the release workflow succeeds on macOS arm64, macOS x64, and Windows
      x64, and verify the published GitHub Release assets and updater metadata.

## Pre-tag verification

- JavaScript: 1,922 tests passed; 9 workflow tests passed.
- Frontend production build completed successfully.
- Cargo formatting and release-version consistency checks passed.
- ESLint completed with no errors and 67 existing warnings.
- The unused-code audit reports the known baseline bench scripts
  (`scripts/bench-ai-translate.mjs`, `scripts/bench-glossary-matcher.mjs`) and
  no additional findings.
- The full Rust suite passed on the release contents before the version-only
  manifest change: 569 tests passed and 2 intentional tests were ignored. The
  release PR's clean GitHub runner will revalidate Rust tests and strict Clippy.
- `git diff --check` passed.

## Release verification

- Release workflow run 30964130317 succeeded on macOS arm64, macOS x64, and
  Windows x64.
- GitHub Release v0.8.86 is published as the latest stable release with DMG,
  zip, NSIS, and MSI assets plus updater signatures for all three platforms.
- `latest.json` reports version 0.8.86 for darwin-aarch64, darwin-x86_64, and
  windows-x86_64 (app, MSI, and NSIS variants).
