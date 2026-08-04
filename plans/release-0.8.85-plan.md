# Release 0.8.85

Date: 2026-08-03

## Contents

- Match batch derived glossaries per pivot row so a glossary term can no longer
  match across the row join, and redistribute batch-derived entries with
  token-sequence containment instead of a substring check (#243).
- Add the globally longest glossary matcher (compiled token trie, exhaustive
  overlap discovery, greedy global selection) to both runtimes behind a
  two-way policy that ships defaulted to the legacy scan, with shared golden
  fixtures keeping the frontend and backend in lockstep (#243).

## Steps

- [x] Audit the release contents and open pull requests.
- [x] Bump version to 0.8.85 in package.json, package-lock.json, Cargo.toml,
      Cargo.lock, and tauri.conf.json.
- [x] Run pre-tag verification: JavaScript and workflow tests, JavaScript lint,
      frontend build, Cargo formatting, Rust tests, version consistency, and
      `git diff --check`.
- [x] Merge the release PR.
- [x] Tag `v0.8.85` and push the tag.
- [x] Confirm the release workflow succeeds on macOS arm64, macOS x64, and Windows
      x64, and verify the published GitHub Release assets and updater metadata.

## Pre-tag verification

- JavaScript: 1,915 tests passed (includes 5 workflow tests).
- Rust: 559 tests passed; 2 ignored (pasteboard smoke test and the offline
  glossary-matcher benchmark).
- Frontend production build completed successfully.
- Cargo formatting and release-version consistency checks passed.
- ESLint completed with no errors and 67 existing warnings.
- The unused-code audit reports the known baseline bench scripts
  (`scripts/bench-ai-translate.mjs`, `scripts/bench-glossary-matcher.mjs`) and
  no additional findings.
- `git diff --check` passed.

## Release verification

- Release workflow run 30877404808 succeeded on macOS arm64, macOS x64, and
  Windows x64.
- GitHub Release v0.8.85 is published with DMG, zip, NSIS, and MSI assets plus
  signatures for all three platforms.
- `latest.json` updater metadata reports version 0.8.85 for darwin-aarch64,
  darwin-x86_64, and windows-x86_64 (app, MSI, and NSIS variants).
