# Release 0.8.39

Patch release after `v0.8.38`.

## Included since 0.8.38

- Glossary / QA-list TMX import (#136):
  - the local repo is resolved correctly while it is still being prepared
    (before the resource file exists), fixing imports that failed with
    "The local glossary repo is not available yet."
  - `prepare_repo` reuses the existing checkout instead of allocating a
    duplicate short-named folder on re-prepare
  - import verification refreshes the installation-resources cache before
    re-listing remote repos
- Dependency license compliance (#137):
  - cargo-deny + license-checker enforce a permissive allowlist via a new
    License Compliance CI job
  - cargo-about generates a bundled `THIRD-PARTY-NOTICES.md` (committed so
    plain cargo builds find the resource; regenerated on release builds)
  - adds CLA.md and CONTRIBUTING.md

## Pre-tag verification

- npm test
- npm run audit:unused
- cargo fmt --manifest-path src-tauri/Cargo.toml --all --check
- npm run test:rust

## Steps

1. Confirm `v0.8.38` release completed before starting the next release.
2. Base the release on `origin/main` (already contains #136 and #137).
3. Bump version to 0.8.39 in package.json, package-lock.json,
   src-tauri/Cargo.toml, src-tauri/Cargo.lock, and src-tauri/tauri.conf.json.
4. Run local verification.
5. Commit "Release 0.8.39", tag v0.8.39, push main + tag.
6. Watch release-tauri.yml publish all release assets and the updater feed.
