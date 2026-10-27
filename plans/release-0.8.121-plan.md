# Release 0.8.121

1. Bump the release metadata from 0.8.120 to 0.8.121 and add user-facing release notes for PR #337.
2. Run version consistency, frontend/workflow, browser, native search, lint, and Rust formatting checks before merging the release PR.
3. Tag the merged release commit `v0.8.121` to publish signed macOS Apple Silicon, macOS Intel, and Windows artifacts through the existing release workflow.
4. Verify the release workflow, published notes, assets, updater entries, and tag ancestry.

## Validation

- Release metadata is consistent across package, Cargo, Tauri, lockfile, and bundled-notices files.
- `npm test`: 2,263 frontend tests passed.
- `npm run test:workflow`: 23 passed.
- `npm run format:rust:check` passed.
- `npm run audit:unused` reports only the existing three unused scripts, five fixture imports, and one editor-footnote export.
