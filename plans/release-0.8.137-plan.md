# Release 0.8.137

1. Start from main at `5d982053`, containing every merge since v0.8.136:
   #395 (already-installed updater prompts), #396 (footnote paragraph indents),
   #397 (export preview scroll during sync), #398 (quote block spacing), #399
   (dev-build image optimization), #400 (quote page breaks), #401 (upright quote
   blocks), #402 (image captions removed with images), #403 (dev version guard),
   and #404 (PDF heading distinction).
2. Synchronize npm, Tauri, Cargo, both lockfiles, and bundled notice versions to
   0.8.137. Add versioned notes covering all ten PRs, with user-facing changes
   first and development changes listed separately.
3. Validate version agreement, dependency stability, notices, the development
   version guard, tests, lint, build, formatting, and locked Cargo metadata.
   Publish a focused release PR and merge after its quality/browser CI passes.
4. Confirm main includes all ten PR merge commits and the version bump. Push an
   annotated v0.8.137 tag at the release merge commit to trigger signed builds.
   The release workflow publishes on tag push, so confirm with Hans first.
5. Monitor macOS Apple Silicon, macOS Intel, Windows, and note publication.
   Verify stable release assets, updater signatures, and latest.json version and
   platform URLs.
