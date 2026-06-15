# Release 0.8.36

Patch release after `v0.8.35`.

## Included since 0.8.35

- Editor insert-link fix:
  - the URL modal now keeps the active editor selection alive while the user
    types the link target
  - submitting the modal inserts the link on the selected text instead of
    closing without changing the row
- Separator insertion:
  - editable row toolbars include a `---` separator button with the tooltip
    `Insert separator`
  - the button inserts literal `<hr>` text at the caret or replaces the current
    selection
  - static editor text, preview, HTML, WordPress, Markdown, TXT, XLSX fallback,
    DOCX, and RTF render the separator as a horizontal rule or thematic break
- App shell:
  - default window width is increased from 1400 to 1470 pixels

## Pre-tag verification

- npm test: passed, 1478 tests
- npm run audit:unused: passed
- cargo fmt --manifest-path src-tauri/Cargo.toml --all --check: passed
- npm run test:rust: passed, 329 tests
- npm run test:browser -- tests/browser/editor-regression.spec.js -g
  "separator button inserts hr markup": passed, 1 test

## Steps

1. Base the release branch on `origin/main` / `v0.8.35`.
2. Apply only the requested editor/link/separator/window changes.
3. Bump version to 0.8.36 in package.json, package-lock.json,
   src-tauri/Cargo.toml, src-tauri/Cargo.lock, and src-tauri/tauri.conf.json.
4. Run local verification.
5. Commit "Release 0.8.36", tag v0.8.36, push main + tag.
6. Watch release-tauri.yml publish all release assets.
