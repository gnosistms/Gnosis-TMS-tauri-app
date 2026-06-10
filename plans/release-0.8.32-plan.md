# Release 0.8.32

Infrastructure release. No user-facing feature changes; its purpose is to ship
the toolchain and licensing work and to validate the release pipeline building
on Node 24 for the first time.

## Included since 0.8.31

- #107 — Adopt local quality gates (Husky pre-commit/pre-push, ESLint, strict
  clippy) from joshicola's #65, with the current tree re-baselined (cargo fmt,
  clippy `-D warnings` fixes, `PermissionsExt` import scoped to macOS).
- #108 — Enable the quality-check GitHub Actions workflow; fix the
  rebase-recovery test's dependence on the host git's default branch
  (`--initial-branch main` on bare test remotes).
- #109 — Interim all-rights-reserved LICENSE (Hans Anderson).
- #110 — Bump quality-check workflow actions to Node 24-based majors.
- #111 — Build and test on Node 24 LTS (CI node-version 24, release builds
  20 → 24, engines drops Node 20).
- #112 — package-lock refreshed for npm 11.

## Release validation focus

The release workflow builds with Node 24 for the first time (was Node 20).
Watch the publish-tauri matrix jobs individually rather than assuming green.

## Pre-tag verification

- npm test: 1362/1362 on Node 24.16.0
- cargo test: 254/254
- npm run audit:unused: clean
- Broker: main committed+pushed, /health 200

## Steps

1. Bump version to 0.8.32 in package.json, src-tauri/Cargo.toml,
   src-tauri/tauri.conf.json; refresh package-lock.json + Cargo.lock.
2. Commit "Release 0.8.32" on main, tag v0.8.32, push main + tag.
3. release-tauri.yml publishes; watch matrix jobs to completion.
