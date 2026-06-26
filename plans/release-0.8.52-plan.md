# Release 0.8.52

Patch release after `v0.8.51`.

## Included since 0.8.51

- Editor: fix broken undo (Cmd/Ctrl+Z) whenever a filter is active. The filtered
  body no longer re-renders every row on each keystroke — the focused field is
  updated in place so the browser's native undo stack survives. The filtered row
  set and highlights still refresh on blur.

## Pre-tag verification

- `npm test`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- pre-push `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`

## Steps

1. Bump version to 0.8.52 across the release files
   (package.json, package-lock.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock,
   src-tauri/tauri.conf.json).
2. Commit "Release 0.8.52", tag v0.8.52, push main + tag.
3. Let GitHub run release-tauri.yml and publish the release assets.
