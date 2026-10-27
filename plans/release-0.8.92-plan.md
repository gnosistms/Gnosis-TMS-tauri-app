# Release 0.8.92

Date: 2026-08-24

## Purpose

Supersede the unpublished `v0.8.91` tag. Its release workflow failed before any
GitHub Release was created because the Sentry source-map credential returned HTTP
401. The public updater therefore remains on 0.8.90.

## Contents since 0.8.90

- Clarify empty-source-row warnings and harden editor replace/footnote validation.
- Keep search highlights aligned after editor row resizes.
- Improve PDF footnote layout and cache prepared PDF images per chapter.
- Preserve local metadata through Git failures and improve expected AI, access,
  offline, and sync error classification.
- Keep strict Rust quality checks compatible with Rust 1.98.
- Make Sentry source-map publishing best-effort so an observability credential
  failure cannot block signed application installers.

## Release gates

- [x] Bump package, Cargo, and Tauri metadata to 0.8.92.
- [x] Run version consistency, JavaScript/workflow tests, frontend build, formatting,
  diff, and practical Rust verification.
- [ ] Publish and merge a release pull request after all required GitHub checks pass.
- [ ] Create and push annotated tag `v0.8.92` from the merged release commit.
- [ ] Verify the release workflow succeeds for macOS arm64, macOS x64, and Windows.
- [ ] Verify the public GitHub Release is stable and contains signed installers,
  updater archives, signatures, and `latest.json` for every supported platform.
- [ ] Verify `latest.json` reports version 0.8.92 and supersedes 0.8.90.

## Release failure policy

Sentry release/source-map commands remain visible in build logs but are non-fatal.
Source maps are always removed from shipped frontend assets whether upload succeeds
or fails. A Sentry credential failure should be repaired independently without
withholding application security or correctness fixes from users.
