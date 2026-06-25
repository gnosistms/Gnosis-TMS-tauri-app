# Release 0.8.47

Patch release after `v0.8.46`.

## Included since 0.8.46

- Fix: footnote click-to-edit behavior, editor scroll preservation, inline link
  editing, and preview/row rendering polish from #146.
- Export: WordPress overwrite lookup now accepts post URLs/permalinks, WordPress
  exports no longer append `[no_toc]`, overwrite warning copy is shorter, AI
  Review completion guidance is clearer, and plain-text export paths preserve
  link destinations from #147.

## Pre-tag verification

- `npm test`
- `npm run format:rust:check`
- `npm run test:rust`

## Steps

1. Bump version to 0.8.47 across the release files
   (package.json, package-lock.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock,
   src-tauri/tauri.conf.json).
2. Commit "Release 0.8.47", tag v0.8.47, push main + tag.
3. Watch release-tauri.yml - confirm Windows + both macOS targets publish and
   the updater `latest.json` is updated.
