# Release 0.8.93

Date: 2026-08-24

## Purpose

Ship the team-query consistency fix that keeps an optimistic team deletion layered
over a stale broker listing and preserves the deleted form in the persistent cache.

## Contents

- Do not treat an observer replay of the optimistic query cache as authoritative
  confirmation of a team lifecycle write.
- Apply pending team write intents before replacing the persistent team cache, so a
  stale post-delete broker response cannot restore the team after navigation.
- Add regression coverage for stale post-delete listings.

## Release gates

- [x] Validate the focused regression and the full JavaScript/workflow test suite.
- [x] Run JavaScript lint, frontend build, version consistency, formatting, Rust,
  and diff checks appropriate to the changed surface.
- [x] Bump package, Cargo, Tauri, lockfile, and bundled notice metadata to 0.8.93.
- [ ] Publish and merge a focused pull request after required GitHub checks pass.
- [ ] Create and push annotated tag `v0.8.93` from the merged release commit.
- [ ] Verify the release workflow succeeds for macOS arm64, macOS x64, and Windows.
- [ ] Verify the stable GitHub Release contains signed installers, updater archives,
  signatures, and `latest.json` identifying version 0.8.93.
