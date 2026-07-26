# Release 0.8.79

Date: 2026-07-26

## Contents

- Add QA-list context to AI Review (#213): support case-sensitive and regular
  expression QA terms, match relevant entries natively, and provide their notes
  as advisory context for single-row and batch reviews.
- Fix the AI Review prompt-vector initialization for strict Clippy on Rust 1.97
  (#214).

## Steps

- [x] Content PRs #213 and #214 merged into `main`.
- [x] Confirm PR Quality Check and Browser Tests are green.
- [x] Bump version to 0.8.79 (package.json, package-lock.json, Cargo.toml,
      Cargo.lock, tauri.conf.json).
- [x] Run pre-tag verification: `npm test` (1,859 passed), `npm run lint:js
      -- --quiet`, `npm run build`, Cargo formatting, version consistency, and
      `git diff --check` passed. PR #214's Rust Quality gate also passed strict
      Clippy and the Rust test suite against the release source.
- [ ] Commit "Release 0.8.79", tag `v0.8.79`, and push `main` plus the tag.
- [ ] Confirm the release workflow succeeds and the GitHub Release publishes
      the expected installers, updater bundles, signatures, and `latest.json`.
