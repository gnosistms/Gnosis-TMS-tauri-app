# Release 0.8.41

Patch release after `v0.8.40`.

## Included since 0.8.40

- Fix: 0.8.10 chapter migration no longer aborts when many chapter titles share
  a long common prefix. Short folder names are now allocated against the existing
  folder names of all other chapters, so a synthesized `-N` suffix can never land
  on a sibling's still-present folder. Unblocks GitHub sync for affected projects.
  ([#138](https://github.com/gnosistms/Gnosis-TMS-tauri-app/pull/138))

## Pre-tag verification

- `npm test` (1481 pass)
- `npm run format:rust:check` (clean)
- `npm run test:rust` (332 pass)

## Steps

1. Bump version to 0.8.41 across the release files
   (package.json, package-lock.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock,
   src-tauri/tauri.conf.json, src-tauri/resources/THIRD-PARTY-NOTICES.md).
2. Commit "Release 0.8.41", tag v0.8.41, push main + tag.
3. Watch release-tauri.yml — confirm Windows + both macOS targets publish and
   the updater `latest.json` is updated.
