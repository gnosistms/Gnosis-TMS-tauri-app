# Release 0.8.96

Date: 2026-09-01

## Goal

Publish the project-transfer selector stability fix as the next patch release
for macOS (Apple silicon and Intel) and Windows.

## Included change

- Keep the Team and Glossary native select menus in the Transfer project modal
  open while background project snapshots and sync progress update the Projects
  screen.

The unrelated open footnote-marker pull request is not included in this release.

## Release steps

- [x] Commit the selector fix with focused unit coverage.
- [x] Bump package, Cargo, Tauri, lockfile, and bundled notice metadata to
  `0.8.96`.
- [x] Run frontend, workflow, Rust, formatting, lint, and diff-integrity checks.
- [ ] Commit and push `main`.
- [ ] Create and push annotated tag `v0.8.96`.
- [ ] Confirm the release workflow succeeds on macOS arm64, macOS x64, and
  Windows.
- [ ] Verify the stable GitHub Release contains signed installers, updater
  archives, signatures, and `latest.json` identifying version `0.8.96`.

## Verification

- `npm test`
- `npm run lint:js`
- `npm run format:rust:check`
- `npm run test:rust`
- `git diff --check`
