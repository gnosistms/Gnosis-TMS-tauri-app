# Release 0.8.118

1. Release from main after PR #333 using an isolated checkout to preserve unrelated local files.
2. Bump the six package/Cargo/Tauri/notice version fields from 0.8.117 to 0.8.118 and add release notes describing the project removal fixes.
3. Validate synchronized metadata, frontend/workflow tests, production build, and whitespace. PR #333 already passed all GitHub quality and Linux/Windows browser checks.
4. Commit the release metadata, fast-forward main, and tag that exact commit v0.8.118 to start the existing signed release workflow.
5. Wait for all three native builds and release notes publication; verify assets and updater manifest before reporting completion.

## Validation

- Package, lockfile, Cargo, Tauri, and notice metadata agree on 0.8.118.
- Frontend tests: 2,232 passed; workflow tests: 23 passed.
- Production frontend build passed with the existing large-chunk warning.
- Whitespace checks passed. The only application metadata changes are version fields.
- PR #333 passed Rust, JavaScript, licenses, secret scan, and Linux/Windows browser checks before this metadata-only release bump.
- Signed native builds, published notes, installers, and updater metadata are verified through the tag-triggered release workflow.
