# Release 0.8.48

Patch release after `v0.8.47`.

## Included since 0.8.47

- Export: plain-text print/export paths now preserve footnote link destinations
  as explicit URLs so downstream outputs, including Vellum-oriented exports, keep
  clickable footnote links from #148.

## Pre-tag verification

- `npm test`
- `npm run format:rust:check`
- `npm run test:rust`

## Steps

1. Bump version to 0.8.48 across the release files
   (package.json, package-lock.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock,
   src-tauri/tauri.conf.json).
2. Commit "Release 0.8.48", tag v0.8.48, push main + tag.
3. Watch release-tauri.yml - confirm Windows + both macOS targets publish and
   the updater `latest.json` is updated.
