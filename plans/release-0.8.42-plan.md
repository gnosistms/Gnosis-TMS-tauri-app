# Release 0.8.42

Patch release after `v0.8.41`.

## Included since 0.8.41

- Feature: add a macOS-only Vellum copy/export option that writes Vellum's
  `co.180g.Vellum.TextEditorContent` pasteboard format, including paragraphs,
  subheads, footnotes, images, and ruby fallback text.

## Pre-tag verification

- `npm test`
- `npm run format:rust:check`
- `npm run test:rust`

## Steps

1. Bump version to 0.8.42 across the release files
   (package.json, package-lock.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock,
   src-tauri/tauri.conf.json, src-tauri/resources/THIRD-PARTY-NOTICES.md).
2. Commit "Release 0.8.42", tag v0.8.42, push main + tag.
3. Watch release-tauri.yml — confirm Windows + both macOS targets publish and
   the updater `latest.json` is updated.
