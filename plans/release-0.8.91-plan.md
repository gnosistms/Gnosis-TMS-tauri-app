# Release 0.8.91

Date: 2026-08-22

## Contents

- Clarify the editor warning for source rows that contain no translatable text
  (#267).
- Fix editor replace payload validation and search-highlight alignment (#268).
- Reject structured footnote text updates before they can be serialized as
  invalid replacement text (#269).
- Keep strict Rust quality checks compatible with Rust 1.98 (#271).
- Use a hanging layout for PDF footnotes so wrapped entries align after a fixed
  number gutter (#272).
- Remediate the current Sentry backlog by classifying expected AI and access
  failures, recognizing additional offline errors, preserving local metadata
  when Git is unavailable, and preventing duplicate metadata-sync rejections
  (#270).

## Release gates

- [x] Freeze the release contents from `main` after #269, #271, #272, and #270
      merged.
- [x] Bump version to 0.8.91 in package.json, package-lock.json, Cargo.toml,
      Cargo.lock, and tauri.conf.json.
- [x] Run version consistency, frontend, workflow, lint, formatting, Rust test,
      strict Clippy, and diff checks.
- [x] Review the release diff and publish it through a pull request.
- [ ] Require green JavaScript, Rust, license, secret, Ubuntu browser, and Windows
      browser checks before merging.

## Publishing and verification

- [ ] Merge the release pull request into `main`.
- [ ] Tag the release commit as `v0.8.91` and push the annotated tag.
- [ ] Verify the release workflow succeeds for macOS arm64, macOS x64, and
      Windows.
- [ ] Verify the public GitHub release, installers, signatures, and updater
      `latest.json` all identify version 0.8.91.
- [ ] Verify the Sentry release `gnosis-tms@0.8.91` exists, refresh the issue
      inventory, and apply the reviewed release-aware resolutions or archival
      states.
- [ ] Record final evidence in the Sentry review plan and rotate the temporary
      Sentry access token.
