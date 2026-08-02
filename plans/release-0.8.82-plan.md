# Release 0.8.82

Date: 2026-08-02

## Contents

- Improve the image-caption link color so links remain readable in the editor.
- When an image is inserted from a WordPress URL, discover its media-library
  caption in the background and copy it into Gnosis TMS without overwriting newer
  image or caption edits (#231).

## Unreleased-change audit

- `main` contains exactly three commits after `v0.8.81`: release-completion
  bookkeeping, the image-caption link-color fix, and WordPress caption import.
- The long-lived local `codex/project-transfer` checkout was compared file by file
  with `origin/main`. Its meaningful modified and untracked files already match
  `main`; the remaining differences are stale 0.8.80 version metadata, an obsolete
  version-sync plan, and AI-review text already released through #216.
- GitHub has no open pull requests in this repository.

## Steps

- [x] Audit `main`, local unpublished commits and files, and open pull requests.
- [x] Bump version to 0.8.82 in package.json, package-lock.json, Cargo.toml,
      Cargo.lock, and tauri.conf.json.
- [x] Run pre-tag verification: JavaScript and workflow tests, JavaScript lint,
      frontend build, Cargo formatting, Rust tests, version consistency, and
      `git diff --check`.
- [ ] Merge the release PR.
- [ ] Tag `v0.8.82` and push the tag.
- [ ] Confirm the release workflow succeeds on macOS arm64, macOS x64, and Windows
      x64, and verify the published GitHub Release assets and updater metadata.

## Pre-tag verification

- JavaScript: 1,877 tests passed; 5 workflow tests passed.
- Rust: 533 tests passed; 1 pasteboard smoke test ignored.
- Frontend production build completed successfully.
- Cargo formatting and release-version consistency checks passed.
- ESLint completed with no errors and 67 existing warnings.
- The unused-code audit reports the known baseline file
  `scripts/bench-ai-translate.mjs` and no additional findings.
- `git diff --check` passed.
