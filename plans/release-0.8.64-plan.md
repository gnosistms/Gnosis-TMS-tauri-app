# Release 0.8.64

Date: 2026-07-17

## Contents

Fixes the disappearing-teams bug (PR #174): the teams listing no longer prunes
stored teams that a broker response failed to verify. Teams missing from a
successful listing are retained as unconfirmed with a 7-day absence clock;
degraded broker entries (`accessDetailsError`) keep the cached record and
capabilities; the Tauri layer now carries `access_details_error` through and
skips caching degraded entries in the write-gate access snapshot.

Pairs with broker 0.2.0 (already deployed), which returns degraded entries
instead of silently dropping installations whose enrichment hit transient
GitHub errors, and retries the top-level listing call on 5xx.

## Steps

- [x] Merge PR #174.
- [x] Bump version to 0.8.64 (package.json, package-lock.json, Cargo.toml,
      Cargo.lock, tauri.conf.json).
- [ ] Commit "Release 0.8.64" to main.
- [ ] Tag `v0.8.64` and push to trigger `release-tauri.yml`.
- [ ] Confirm the release build and updater artifacts publish successfully on
      every platform (Windows + macOS arm64/x64) before considering the
      release complete.
