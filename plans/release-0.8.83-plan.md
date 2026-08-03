# Release 0.8.83

Date: 2026-08-03

## Contents

- Improve WordPress image-caption lookup (#234).
- Restore glossary highlighting for Traditional Chinese and other language tags
  whose script or region casing differs between glossary and project data (#235).
- Preserve canonical BCP 47-style language-code casing when importing glossaries.

## Steps

- [x] Audit the release contents and open pull requests.
- [x] Bump version to 0.8.83 in package.json, package-lock.json, Cargo.toml,
      Cargo.lock, and tauri.conf.json.
- [x] Run pre-tag verification: JavaScript and workflow tests, JavaScript lint,
      frontend build, Cargo formatting, Rust tests, version consistency, and
      `git diff --check`.
- [ ] Merge the release PR.
- [ ] Tag `v0.8.83` and push the tag.
- [ ] Confirm the release workflow succeeds on macOS arm64, macOS x64, and Windows
      x64, and verify the published GitHub Release assets and updater metadata.

## Pre-tag verification

- JavaScript: 1,880 tests passed; 5 workflow tests passed.
- Browser: 124 tests passed; 1 performance probe skipped.
- Rust: 541 tests passed; 1 pasteboard smoke test ignored.
- Frontend production build completed successfully.
- Cargo formatting and release-version consistency checks passed.
- ESLint completed with no errors and 67 existing warnings.
- The unused-code audit reports the known baseline file
  `scripts/bench-ai-translate.mjs` and no additional findings.
- `git diff --check` passed.

## Release verification

Pending.
