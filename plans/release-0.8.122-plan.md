# Release 0.8.122

1. Bump release metadata from 0.8.121 to 0.8.122 across the package, Tauri,
   Cargo, lockfile, and bundled-notices files.
2. Add user-facing notes for the editor's local glossary refresh: glossary terms
   saved locally are available immediately while GitHub sync continues, and
   stale refresh races are guarded when returning to the editor.
3. Run release-version consistency, frontend/workflow, lint, build, formatting,
   and relevant Rust checks before committing the release metadata.
4. Push the release commit to `main`, create and push annotated tag `v0.8.122`,
   then verify the release workflow and published assets.

## Validation

- Version metadata is synchronized at 0.8.122 across package, Cargo, Tauri,
  lockfile, and bundled-notices files.
- `node scripts/guard-dev-app-version.mjs` passed.
- `npm test`: 2,280 application tests passed; the four launcher tests passed
  separately with local server access.
- `npm run format:rust:check` passed.
- JavaScript lint passed with the repository's existing warnings.
- Production frontend build passed with the existing large-chunk warning.
- `git diff --check` passed.
- `npm run audit:unused` reports the same existing three unused scripts, five
  browser-test imports, and one editor-footnote export.
