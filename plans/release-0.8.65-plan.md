# Release 0.8.65

Date: 2026-07-21

## Contents

Adds one-click PDF export through a pinned Typst sidecar (PR #175). The export
supports standard paper sizes, the app's serif font family, images with italic
captions, and mid-paragraph footnotes. The UI reports staged progress and lets
users cancel an in-progress export. Font files are checksum-verified, cached in
application data, and reused across app updates.

## Steps

- [x] Merge PR #175.
- [x] Bump version to 0.8.65 (package.json, package-lock.json, Cargo.toml,
      Cargo.lock, tauri.conf.json).
- [ ] Commit "Release 0.8.65" to main.
- [ ] Tag `v0.8.65` and push to trigger `release-tauri.yml`.
- [ ] Confirm the release build and updater artifacts publish successfully on
      every platform (Windows + macOS arm64/x64) before considering the
      release complete.
