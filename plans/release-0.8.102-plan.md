# Release 0.8.102

## Goal

Ship the changes merged since `v0.8.101` as the next patch release for macOS
(Apple silicon and Intel) and Windows.

## Included changes

- Strengthen alignment conflict recovery and sentence splitting.
- Keep glossary and QA navigation stable while term writes are in progress.
- Add an editor filter for deleted rows.
- Allow chapter-wide marker updates with settled soft-deleted rows and prevent
  queued Clear translations from writing to a row deleted earlier in the queue.

## Release steps

- [x] Confirm `v0.8.101` is the latest stable release and that main contains
  the merged changes.
- [x] Check the release credential checklist: the desktop app contains only the
  public broker URL and no GitHub app fallback credential.
- [x] Bump package, Cargo, Tauri, lockfile, and bundled notice metadata to
  `0.8.102`.
- [ ] Run release validation and merge the release pull request.
- [ ] Create and push annotated tag `v0.8.102` from the merged release commit.
- [ ] Confirm the release workflow succeeds on macOS arm64, macOS x64, and
  Windows and publishes signed installers, updater archives, signatures, and
  `latest.json`.

## Validation

- Version metadata check passed: package, lockfile, Cargo, and Tauri manifests
  all report `0.8.102`.
- `npm test` passed: 2,105 frontend tests and 13 workflow tests.
- `npm run format:rust:check`, `npm run lint:rust:strict`, and `npm run test:rust`
  passed: 657 Rust tests passed, 3 ignored.
- `npm run lint:js` passed with 63 existing warnings and no errors.
- `git diff --check` and the development version guard passed.
- `npm run audit:unused` reports the existing two benchmark scripts, five browser
  test imports, and `ensureEditorFootnoteEntry`; the release bump introduces no
  new audit finding.
