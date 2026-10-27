# Release 0.8.98

Date: 2026-09-02

## Goal

Publish all changes merged since `v0.8.97` as the next patch release for macOS
(Apple silicon and Intel) and Windows.

## Included changes

- Cache and validate WordPress export images so repeated exports reuse safe image
  data without accepting stale or mismatched files.
- Present project search results as a nested project, chapter, and row tree with
  direct chapter navigation and complete matching excerpts.
- Categorize search rows as strong or weaker matches, show strong results by
  default, and let users reveal the weaker matches without rerunning the query.
- Improve project and chapter heading sizes in categorized search results.

## Release steps

- [x] Confirm `v0.8.97` is the latest stable release and `main` is clean.
- [x] Audit merged changes and open pull requests; open PR #259 is not included.
- [ ] Bump package, Cargo, Tauri, lockfile, and bundled notice metadata to
  `0.8.98`.
- [ ] Run frontend, workflow, Rust, formatting, lint, and diff-integrity checks.
- [ ] Publish and merge the release pull request after all required checks pass.
- [ ] Create and push annotated tag `v0.8.98` from the merged release commit.
- [ ] Confirm the release workflow succeeds on macOS arm64, macOS x64, and
  Windows.
- [ ] Verify the stable GitHub Release contains signed installers, updater
  archives, signatures, and `latest.json` identifying version `0.8.98`.

## Verification

- `npm test`
- `npm run lint:js`
- `npm run format:rust:check`
- `npm run test:rust`
- `git diff --check`
