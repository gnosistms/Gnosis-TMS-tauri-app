# Release 0.8.94

Date: 2026-08-25

## Purpose

Ship multi-site WordPress export connections so each file can remember its own
WordPress site and post while credentials remain isolated per Gnosis login.

## Contents

- Store and manage unlimited WordPress.com, Jetpack-connected, and self-hosted
  WordPress connections per Gnosis login.
- Restore each file's last successful WordPress site and post independently.
- Add site discovery, the connected-site picker, self-hosted Basic Authentication,
  reconnect, disconnect, and global forget-site flows.
- Pin WordPress.com OAuth to the requested site and reject reauthorization against
  a different WordPress blog.
- Improve the export panel's WordPress controls and site-classification flow.

## Release gates

- [x] Merge the app and broker feature pull requests after required checks pass.
- [x] Run the full JavaScript/workflow and Rust test suites, frontend build,
  formatting, focused WordPress tests, and cross-platform browser CI.
- [x] Bump package, Cargo, Tauri, lockfile, and bundled notice metadata to 0.8.94.
- [ ] Publish and merge a focused release pull request after required checks pass.
- [ ] Create and push annotated tag `v0.8.94` from the merged release commit.
- [ ] Verify the release workflow succeeds for macOS arm64, macOS x64, and Windows.
- [ ] Verify the stable GitHub Release contains signed installers, updater archives,
  signatures, and `latest.json` identifying version 0.8.94.
