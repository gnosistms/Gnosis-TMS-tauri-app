# Release 0.8.140

1. Start from main at `bbbf308f`, containing the merges since v0.8.139:
   #413 (title-page line breaks stay on the title page; EPUB title comes from
   the title page), #414 (export redundancy page stays still during project
   refresh) and #415 (duplicate image warning on insert).
2. Synchronize npm, Tauri, Cargo, both lockfiles, and bundled notice versions to
   0.8.140. Add versioned notes covering #413, #414 and #415.
3. Validate version agreement, locked Cargo metadata, formatting, tests, and lint.
   Publish a focused release PR and merge after its quality/browser CI passes.
   Main's quality and browser CI passed at `bbbf308f`.
4. Confirm main includes the three merges and the version bump. Push an
   annotated v0.8.140 tag at the release merge commit to trigger signed builds.
   Hans asked for this release on 2026-10-29.
5. Monitor macOS Apple Silicon, macOS Intel, Windows, and note publication.
   Verify stable release assets, updater signatures, and latest.json version and
   platform URLs.
