# Release 0.8.125

1. Bump release metadata from 0.8.124 to 0.8.125 across the package, Tauri,
   Cargo, lockfile, and bundled-notices files.
2. Add user-facing notes for the change since 0.8.124: AI Translate renders
   spoken-language tags and fillers naturally, subtitle cues are translated in
   adjacent stretches that may move words between neighbouring lines, and
   meaning review reads neighbouring subtitle lines together (#348).
3. Run release-version consistency, frontend/workflow, lint, build, formatting,
   and lockfile checks before committing the release metadata.
4. Merge the release PR, create and push annotated tag `v0.8.125` on the merge
   commit, then verify the release workflow and published assets.

## Validation

- Version metadata is synchronized at 0.8.125 across package, Cargo, Tauri,
  lockfile, and bundled-notices files.
- `node scripts/guard-dev-app-version.mjs` passed.
- `npm test`: 2,322 application tests and 23 workflow tests passed.
- `npm run format:rust:check` passed; `cargo metadata --locked` accepts the
  updated `Cargo.lock`.
- JavaScript lint passed with the repository's existing 62 warnings.
- Production frontend build passed.
- `git diff --check` passed.
- `npm run audit:unused` reports the same existing three unused scripts, five
  browser-test imports, and one editor-footnote export.
