# Release 0.8.38

Patch release after `v0.8.37`.

## Included since 0.8.37

- Footnote separator behavior:
  - preview and WordPress export no longer insert an automatic separator before
    the collected footnotes block
  - user-inserted `<hr>` separators continue to render/export normally

## Pre-tag verification

- npm test: passed, 1479 tests
- npm run audit:unused: passed
- cargo fmt --manifest-path src-tauri/Cargo.toml --all --check: passed
- npm run test:rust: passed, 329 tests

## Steps

1. Confirm `v0.8.37` release completed before starting the next release.
2. Base the release branch on `origin/main` / `v0.8.37`.
3. Remove the implicit footnote separator and update focused preview tests.
4. Bump version to 0.8.38 in package.json, package-lock.json,
   src-tauri/Cargo.toml, src-tauri/Cargo.lock, and src-tauri/tauri.conf.json.
5. Run local verification.
6. Commit "Release 0.8.38", tag v0.8.38, push main + tag.
7. Watch release-tauri.yml publish all release assets.
