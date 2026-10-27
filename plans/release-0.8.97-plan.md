# Release 0.8.97

Date: 2026-09-01

## Goal

Publish all changes merged since `v0.8.96` as the next patch release for macOS
(Apple silicon and Intel) and Windows.

## Included changes

- Add a downloadable Spanish-to-English TMX sample to the glossary import modal,
  demonstrating supported variants, notes, footnotes, and omission entries.
- Remember the last successful WordPress post separately for every saved site and
  chapter, restore overwrite targets when switching sites, and safely migrate the
  previous single-site association format.

## Release steps

- [x] Confirm `main` is clean and contains only the intended changes since
  `v0.8.96`.
- [x] Bump package, Cargo, Tauri, lockfile, and bundled notice metadata to
  `0.8.97`.
- [x] Run frontend, workflow, Rust, formatting, lint, and diff-integrity checks.
- [ ] Commit and push `main`.
- [ ] Create and push annotated tag `v0.8.97`.
- [ ] Confirm the release workflow succeeds on macOS arm64, macOS x64, and
  Windows.
- [ ] Verify the stable GitHub Release contains signed installers, updater
  archives, signatures, and `latest.json` identifying version `0.8.97`.

## Verification

- `npm test`
- `npm run lint:js`
- `npm run format:rust:check`
- `npm run test:rust`
- `git diff --check`
