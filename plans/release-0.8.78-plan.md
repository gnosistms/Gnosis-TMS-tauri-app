# Release 0.8.78

Date: 2026-07-26

## Contents

- Fix Chinese language selection (#209): the target-language action dispatcher
  now accepts supported language codes with subtags, including `zh-Hans` and
  `zh-Hant`.
- Fix first-load project bootstrap for newly invited members (#210): refresh
  project metadata after team sync, preserve per-project loading/error state,
  and avoid persisting incomplete pre-clone snapshots.
- Add document inputs for chapter translations (#211): the Add translations
  flow now supports TXT, DOCX, RTF, and public Google Docs links while reusing
  the Add files input design and extracting plain text only.
- Add translated captions to image duplication (#212): keep the existing
  image-only duplicate action and add an AI-assisted caption option with
  overwrite confirmation, cancellation, and source/destination concurrency
  guards.

## Steps

- [x] Content PRs #209, #210, #211, and #212 merged into `main`.
- [x] Confirm current `main` Quality Check and Browser Tests are green.
- [x] Confirm the public-release credential checklist and secret scan are clean.
- [x] Bump version to 0.8.78 (package.json, package-lock.json, Cargo.toml,
      Cargo.lock, tauri.conf.json).
- [x] Pre-tag verification: `npm test` (1,854 passed), `npm run lint:js
      -- --quiet`, `npm run build`, Cargo formatting, and `npm run test:rust`
      (513 passed, 1 ignored) succeeded. `npm run audit:unused` reports only
      the known `scripts/bench-ai-translate.mjs` baseline.
- [ ] Commit "Release 0.8.78", tag `v0.8.78`, and push `main` plus the tag.
- [ ] Confirm the release workflow succeeds on macOS arm64, macOS x64, and
      Windows x64; confirm the published GitHub Release has installers,
      updater bundles and signatures, and latest.json references 0.8.78 for
      all supported platform keys.
