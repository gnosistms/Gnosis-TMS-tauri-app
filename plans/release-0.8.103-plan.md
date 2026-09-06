# Release 0.8.103

## Goal

Ship the changes merged since `v0.8.102` as the next patch release for macOS
(Apple silicon and Intel) and Windows.

## Included changes

- Show a login spinner in the start hero while restoring the session.
- Cut AI Translate All overhead measured on the critical path.
- Start the stored session inspection alongside the connectivity probe and use
  a HEAD request for the reachability check, so a stored login restores sooner.
- Add a local development Dock launcher and dev version sync (development
  tooling only; nothing bundled into the app).

## Release steps

- [x] Confirm `v0.8.102` is the latest stable release and that main contains
  the merged changes.
- [x] Check the release credential checklist: the desktop source contains no
  GitHub App fallback credential or client secret; only runtime keypair
  storage for team AI members.
- [x] Bump package, Cargo, Tauri, lockfile, and bundled notice metadata to
  `0.8.103`.
- [ ] Run release validation and merge the release pull request.
- [ ] Create and push annotated tag `v0.8.103` from the merged release commit.
- [ ] Confirm the release workflow succeeds on macOS arm64, macOS x64, and
  Windows and publishes signed installers, updater archives, signatures, and
  `latest.json`.

## Validation

- Version metadata check passed: package, lockfile, Cargo, and Tauri manifests
  all report `0.8.103`, and the development version guard accepts it.
- `npm test` passed: 2,125 frontend tests and 23 workflow tests.
- `git diff --check` passed.
- Rust formatting, Clippy, and Rust tests are delegated to the pull request CI
  (Rust Quality job); the bump changes only version metadata.
