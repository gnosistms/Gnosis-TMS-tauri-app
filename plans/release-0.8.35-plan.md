# Release 0.8.35

Patch release after `v0.8.34`.

## Included since 0.8.34

- #135 - Preview mode read-to-edit jump:
  - single-click preview text shows the lower-right hint badge
    `Double click to edit this text`
  - double-click preview text switches to Translate mode and scrolls to the
    matching row/language
  - the jump replaces the saved Translate-mode editor location with the clicked
    preview paragraph anchor

## Pre-tag verification

- npm test: passed, 1468 tests
- cargo test --manifest-path src-tauri/Cargo.toml: passed, 326 tests
- npm run audit:unused: passed

## Steps

1. Bump version to 0.8.35 in package.json, package-lock.json,
   src-tauri/Cargo.toml, src-tauri/Cargo.lock, and src-tauri/tauri.conf.json.
2. Run local verification.
3. Commit "Release 0.8.35" on main, tag v0.8.35, push main + tag.
4. Watch release-tauri.yml publish all release assets.
