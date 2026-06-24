# Release 0.8.44

Patch release after `v0.8.43`.

## Included since 0.8.43

- Feature: Vellum export writes both editor-content and whole-chapter pasteboard
  formats, including chapter-title handling and image resource metadata.
- Fix: Vellum image paste resources survive clipboard handoff by preparing
  pasteboard-scoped image files without recompressing them.
- Fix: preview language and preview scroll position are persisted per chapter.
- Fix: preview and HTML export no longer double-escape quoted text.

## Pre-tag verification

- `npm test`
- `npm run format:rust:check`
- `npm run test:rust`

## Steps

1. Bump version to 0.8.44 across the release files
   (package.json, package-lock.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock,
   src-tauri/tauri.conf.json, src-tauri/resources/THIRD-PARTY-NOTICES.md if regenerated).
2. Commit "Release 0.8.44", tag v0.8.44, push main + tag.
3. Watch release-tauri.yml — confirm Windows + both macOS targets publish and
   the updater `latest.json` is updated.
