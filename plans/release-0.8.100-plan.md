# Release 0.8.100

Date: 2026-09-04

## Goal

Publish all changes merged since `v0.8.99` as the next patch release for macOS
(Apple silicon and Intel) and Windows.

## Included changes

- Retain normal glossary popovers for source terms and closed target-language
  glossary terms.
- Show the footnote label and Ctrl+F insertion guidance only for target terms
  whose glossary record contains a footnote.
- Insert numbered footnote markers directly after the hovered target term while
  preserving inline formatting and ruby markup offsets.
- Keep footnote insertion unavailable while the target editor is open, use the
  standard arrow cursor, and make repeated-term hover transitions reliable.

## Release steps

- [x] Confirm `v0.8.99` is the latest stable release and `main` is clean.
- [x] Audit merged changes: PR #287 is the only change since `v0.8.99`; open
  PR #259 is not included.
- [x] Bump package, Cargo, Tauri, lockfile, and bundled notice metadata to
  `0.8.100`.
- [x] Run frontend, workflow, Rust, formatting, lint, and diff-integrity checks.
- [ ] Publish and merge the release pull request after all required checks pass.
- [ ] Create and push annotated tag `v0.8.100` from the merged release commit.
- [ ] Confirm the release workflow succeeds on macOS arm64, macOS x64, and
  Windows.
- [ ] Verify the stable GitHub Release contains signed installers, updater
  archives, signatures, and `latest.json` identifying version `0.8.100`.

## Verification

- `npm test`
- `npm run lint:js`
- `npm run format:rust:check`
- `npm run test:rust`
- `git diff --check`
