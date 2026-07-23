# Release 0.8.71

Date: 2026-07-23

## Why this release exists

v0.8.70 shipped broken: its code pins the sha256 of the regenerated Cormorant
fonts (uppercase hook fix), but the font binaries in the bundle are the previous
build — the commit updated the hashes without committing the fonts. Both builds
are byte-identical in size, so only the integrity check catches it, and it does:
every Latin-script PDF export in 0.8.70 fails with "The bundled PDF font failed
its integrity check." Recovery follows the v0.8.39→v0.8.40 precedent: ship a
complete release, then delete the broken one.

## Contents

- Commit the regenerated Cormorant Garamond Gnosis fonts (Roman + Italic) that
  the uppercase-hook fix regenerated but never committed. Both reproduce
  byte-identically from scripts/patch-cormorant-vietnamese-accents.py.
- Chapter titles now render in the heading typeface (Cormorant Garamond Gnosis)
  instead of the body face: the title is emitted as plain styled text, which the
  `#show heading` rule never reached. A `gnosis-title` helper in the preamble
  applies the heading family when the language has one; non-Latin scripts keep
  their current title styling.

## Steps

- [x] Commit fonts + script (67fbfc3e) and title fix (6bbae7dd); push to main.
- [x] Bump version to 0.8.71 (package.json, package-lock.json, Cargo.toml,
      Cargo.lock, tauri.conf.json).
- [x] Pre-tag verification: npm test, npm run audit:unused, cargo fmt check,
      npm run test:rust.
- [x] Commit "Release 0.8.71", tag `v0.8.71`, push main + tag.
- [x] Confirm the release build and updater artifacts publish successfully on
      every platform (Windows + macOS arm64/x64) — watch each job, not just the
      run status.
- [ ] After 0.8.71 is fully published, delete the v0.8.70 release and tag
      (requires explicit confirmation).
