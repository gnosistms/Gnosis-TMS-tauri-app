# Release 0.8.37

Patch release after `v0.8.36`.

## Included since 0.8.36

- Separator toolbar button:
  - the visible button label changes from `---` to `--` to save toolbar space
  - insertion behavior is unchanged; the button still inserts literal `<hr>`

## Pre-tag verification

- npm test: passed, 1478 tests
- npm run audit:unused: passed
- cargo fmt --manifest-path src-tauri/Cargo.toml --all --check: passed
- npm run test:rust: passed, 329 tests

## Steps

1. Base the release branch on `origin/main` / `v0.8.36`.
2. Change the separator button label and update the focused unit expectation.
3. Bump version to 0.8.37 in package.json, package-lock.json,
   src-tauri/Cargo.toml, src-tauri/Cargo.lock, and src-tauri/tauri.conf.json.
4. Run local verification.
5. Commit "Release 0.8.37", tag v0.8.37, push main + tag.
6. Watch release-tauri.yml publish all release assets.
