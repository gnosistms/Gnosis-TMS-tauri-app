# Release 0.8.51

Patch release after `v0.8.50`.

## Included since 0.8.50

- Editor: stop AI Review All from creating a blank `[1]` footnote on every
  corrected row that previously had no footnote. The apply path now only writes
  a footnote when the suggestion is non-empty, matching the single-row apply
  path and the backend guard.

## Pre-tag verification

- `npm test`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- pre-push `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`

## Steps

1. Bump version to 0.8.51 across the release files
   (package.json, package-lock.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock,
   src-tauri/tauri.conf.json).
2. Commit "Release 0.8.51", tag v0.8.51, push main + tag.
3. Let GitHub run release-tauri.yml and publish the release assets.
