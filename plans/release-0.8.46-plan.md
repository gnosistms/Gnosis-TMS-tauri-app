# Release 0.8.46

Patch release after `v0.8.45`.

## Included since 0.8.45

- Fix: project repos cloned but never checked out (empty working tree, valid
  HEAD, no on-disk `.gtms/repo.json`) no longer wedge behind the
  migration-discard prompt. `sync_project_repo` now auto-heals a checkout-less
  repo by restoring the checkout from HEAD (lossless: empty tree holds no work),
  and `clone_project_repo` clones atomically via a temp directory so an aborted
  clone never leaves a half-cloned repo behind (#144).
- CI: cache compiled Rust dependencies in the Quality Check workflow so clippy
  and tests stop recompiling the dependency tree from scratch every run (#145).

## Pre-tag verification

- `npm test`
- `npm run format:rust:check`
- `npm run test:rust`

## Steps

1. Bump version to 0.8.46 across the release files
   (package.json, package-lock.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock,
   src-tauri/tauri.conf.json, src-tauri/resources/THIRD-PARTY-NOTICES.md).
2. Commit "Release 0.8.46", tag v0.8.46, push main + tag.
3. Watch release-tauri.yml - confirm Windows + both macOS targets publish and
   the updater `latest.json` is updated.
