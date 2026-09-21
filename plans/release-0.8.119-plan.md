# Release 0.8.119

1. Carry only the platform-aware updater fix onto current main in an isolated
   checkout. Preserve the original working tree and unrelated planning files.
2. Commit the updater change and its regressions, then separately bump the six
   package/Cargo/Tauri/notice metadata files and add release notes.
3. Run frontend/workflow tests and the production frontend build on the release
   branch. Run the strict Rust pre-push checks and wait for GitHub quality and
   Linux/Windows browser checks before merging the PR.
4. Tag the merged release commit v0.8.119 and push that tag to trigger the signed
   macOS Apple Silicon, macOS Intel, and Windows release workflow.
5. Verify every native build, published release notes, updater platform entry,
   and expected installer asset before reporting the release complete.

## Prior fix validation

- 2,245 frontend tests, 23 workflow tests, four updater browser tests, and 14
  native updater tests passed before the release checkout was created.
- The fix applied cleanly to main at v0.8.118.
- Unused-code audit findings are unchanged from the existing baseline.
