# Release 0.8.43

Patch release after `v0.8.42`.

## Included since 0.8.42

- Fix: preserve Vellum image paste resources by copying referenced image files
  into a pasteboard-scoped temp directory and exposing valid resource metadata
  for Vellum.
- Feature: default preview mode to each chapter's target language and persist
  explicit preview language overrides per chapter instead of globally.

## Pre-tag verification

- `npm test`
- `npm run format:rust:check`
- `npm run test:rust`

## Steps

1. Bump version to 0.8.43 across the release files
   (package.json, package-lock.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock,
   src-tauri/tauri.conf.json, src-tauri/resources/THIRD-PARTY-NOTICES.md).
2. Commit "Release 0.8.43", tag v0.8.43, push main + tag.
3. Watch release-tauri.yml — confirm Windows + both macOS targets publish and
   the updater `latest.json` is updated.
