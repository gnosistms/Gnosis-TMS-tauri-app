# Release 0.8.136

1. Start from main at `54023ba7`, containing every merge since v0.8.135:
   #390 (glossary browser preflight regression), #391 (PDF attribution spacing),
   #392 (chapter/book EPUB export), and #393 (case-only glossary/QA duplicates).
2. Synchronize npm, Tauri, Cargo, both lockfiles, and bundled notice versions to
   0.8.136. Add versioned notes covering all four PRs, with user-facing changes
   first and test maintenance listed separately.
3. Validate version agreement, dependency stability, notices, the development
   version guard, tests, lint, build, formatting, and locked Cargo metadata.
   Publish a focused release PR and merge after its quality/browser CI passes.
4. Confirm main includes all four PR merge commits and the version bump. Push an
   annotated v0.8.136 tag at the release merge commit to trigger signed builds.
5. Monitor macOS Apple Silicon, macOS Intel, Windows, and note publication.
   Verify stable release assets, updater signatures, and latest.json version and
   platform URLs. Publish the release without installing it locally.

## Local validation

- All seven version values agree on 0.8.136; the development version guard and
  locked offline Cargo metadata pass.
- All 3,213 frontend tests and 25 workflow tests pass.
- Strict all-target Rust Clippy, full JavaScript lint, production build, Rust
  formatting, and whitespace checks pass.
- Regenerated notices differ only in the app version after preserving LF;
  manifests and lockfiles contain no dependency changes.
- The unused-code audit retains 41 unused files and 16 exports outside this
  release change.
- All four post-v0.8.135 PR merge commits are ancestors of this branch, and all
  four PRs are linked in the release notes.
