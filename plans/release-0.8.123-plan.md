# Release 0.8.123

1. Bump release metadata from 0.8.122 to 0.8.123 across the package, Tauri,
   Cargo, lockfile, and bundled-notices files.
2. Add user-facing notes for the changes since 0.8.122: the "Changed after my
   last edit" editor filter (#344), Claude Opus 5.5 support and streamed prompts
   (#341), and Claude parity with AI Assistant prompt caching (#342, #343).
3. Run release-version consistency, frontend/workflow, lint, build, formatting,
   and lockfile checks before committing the release metadata.
4. Merge the release PR, create and push annotated tag `v0.8.123` on the merge
   commit, then verify the release workflow and published assets.

## Validation

- Version metadata is synchronized at 0.8.123 across package, Cargo, Tauri,
  lockfile, and bundled-notices files.
- `node scripts/guard-dev-app-version.mjs` passed.
- `npm test`: 2,315 application tests and 23 workflow tests passed.
- `npm run format:rust:check` passed; `cargo metadata --locked` accepts the
  updated `Cargo.lock`.
- JavaScript lint passed with the repository's existing 62 warnings.
- Production frontend build passed.
- `git diff --check` passed.
- `npm run audit:unused` reports the same existing three unused scripts, five
  browser-test imports, and one editor-footnote export.
