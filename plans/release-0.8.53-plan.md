# Release 0.8.53

Patch release after `v0.8.52`.

## Included since 0.8.52

- Chapter editor: fix load failing on large chapters (500+ rows) on Windows.
  `load_latest_row_version_metadata_by_path` built a `git log --name-only`
  invocation with one argument per row file; on Windows this exceeded the
  ~32,767-character `CreateProcess` command line limit, and the resulting
  spawn error (containing every row path) was surfaced as the chapter's
  content in the editor. Now passes the chapter's `rows/` directory as a
  single pathspec instead. (#152)

## Pre-tag verification

- `npm test`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- pre-push `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`

## Steps

1. Bump version to 0.8.53 across the release files
   (package.json, package-lock.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock,
   src-tauri/tauri.conf.json).
2. Commit "Release 0.8.53", tag v0.8.53, push main + tag.
3. Let GitHub run release-tauri.yml and publish the release assets.
