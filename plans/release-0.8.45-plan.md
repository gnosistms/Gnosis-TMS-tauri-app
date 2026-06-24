# Release 0.8.45

Patch release after `v0.8.44`.

## Included since 0.8.44

- Fix: Vellum private pasteboard export preserves within-row line breaks as
  soft line separators instead of paragraph separators.
- Fix: DOCX export writes within-row line breaks as `<w:br/>` inside the same
  paragraph instead of a raw newline inside a text run.

## Pre-tag verification

- `npm test`
- `npm run format:rust:check`
- `npm run test:rust`

## Steps

1. Bump version to 0.8.45 across the release files
   (package.json, package-lock.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock,
   src-tauri/tauri.conf.json, src-tauri/resources/THIRD-PARTY-NOTICES.md).
2. Commit "Release 0.8.45", tag v0.8.45, push main + tag.
3. Watch release-tauri.yml - confirm Windows + both macOS targets publish and
   the updater `latest.json` is updated.
