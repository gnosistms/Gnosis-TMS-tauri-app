# Release 0.8.66

Date: 2026-07-21

## Contents

Improves PDF export reliability for remote images (PR #176). Wikimedia and
similar hosts now receive an application-identifying User-Agent, transient
download failures are retried once, and an unavailable remote image produces a
labeled placeholder instead of aborting the PDF. Long export errors also wrap
inside the export modal.

## Steps

- [x] Merge PR #176.
- [x] Bump version to 0.8.66 (package.json, package-lock.json, Cargo.toml,
      Cargo.lock, tauri.conf.json).
- [ ] Commit "Release 0.8.66" to main.
- [ ] Tag `v0.8.66` and push to trigger `release-tauri.yml`.
- [ ] Confirm the release build and updater artifacts publish successfully on
      every platform (Windows + macOS arm64/x64) before considering the
      release complete.
