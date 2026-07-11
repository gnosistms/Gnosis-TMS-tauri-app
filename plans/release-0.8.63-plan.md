# Release 0.8.63

Date: 2026-07-11

## Contents

Removes the temporary source-word-count bulk backfill added in #98, per its scheduled
2026-06-23 removal (PR #173). The permanent read-side cache, editor-load refresh,
batched persist helper, and merge-resolver rule for `source_word_count` are unchanged.

## Steps

- [x] Merge PR #173.
- [x] Bump version to 0.8.63 (package.json, package-lock.json, Cargo.toml, Cargo.lock,
      tauri.conf.json).
- [x] Commit "Release 0.8.63" to main.
- [x] Tag `v0.8.63` and push to trigger `release-tauri.yml`.
- [x] Confirm the release build and updater artifacts publish successfully on every
      platform (Windows + macOS arm64/x64) before considering the release complete.
