# Release 0.8.138

1. Start from main at `2d286707`, containing every merge since v0.8.137: #406
   (chapter cover pages and drop caps sized to the opening paragraph), #407 (EPUB
   export for image-heavy books with progress, plus `5e465855`, PDF footnotes
   running over with a single line), #408 (blank lines inside a row as paragraph
   breaks), and #409 (repair of uploaded images left in per-row folders, as
   content migration `0.8.138`).
2. Synchronize npm, Tauri, Cargo, both lockfiles, and bundled notice versions to
   0.8.138. Add versioned notes covering all four PRs and the footnote commit.
3. Validate version agreement, locked Cargo metadata, formatting, tests, and lint.
   Publish a focused release PR and merge after its quality/browser CI passes.
4. Confirm main includes all four PR merge commits and the version bump. Push an
   annotated v0.8.138 tag at the release merge commit to trigger signed builds.
   Hans asked for this release on 2026-10-28.
5. Monitor macOS Apple Silicon, macOS Intel, Windows, and note publication.
   Verify stable release assets, updater signatures, and latest.json version and
   platform URLs.
