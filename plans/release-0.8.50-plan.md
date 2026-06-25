# Release 0.8.50

Patch release after `v0.8.49`.

## Included since 0.8.49

- Editor: surface URL image conflicts in the conflict-resolution modal.
- Editor: persist resolved URL image choices through the row-fields backend command.
- Editor: trim non-labeled footnote text consistently to avoid blank marker lines.

## Pre-tag verification

- `npm test`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- pre-push `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`

## Steps

1. Bump version to 0.8.50 across the release files
   (package.json, package-lock.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock,
   src-tauri/tauri.conf.json).
2. Commit "Release 0.8.50", tag v0.8.50, push main + tag.
3. Let GitHub run release-tauri.yml and publish the release assets.
