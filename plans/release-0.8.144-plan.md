# Release 0.8.144

1. Cut `claude/release-0.8.144` from `claude/release-0.8.140` at `e86491d5`:
   14 commits after the 0.8.143 release (`d3e57776`), made directly on that
   branch. Two of them (the footnote redundancy fixes) were already
   cherry-picked into 0.8.143. The rest cover audio and video rows and their
   exports, the [1] footnote button, the WordPress image-footnote search
   spinner, and paragraph indents in the book export and the editor Preview,
   including per-language indents for Chinese, Japanese, Korean, Arabic and
   Persian. The branch did not contain v0.8.143, so `origin/main` was merged
   in; the only conflict was the status line of
   `plans/redundancy-identical-footnote-candidates.md`, taken from main.
   The [1] label kerning fix (`070bf093`), made on `claude/release-0.8.140`
   after the cut, was cherry-picked onto `claude/release-0.8.144` at Hans's
   request before merging. So were three later commits from that branch:
   paragraph breaks kept when highlights redraw a row (`46846c32`), AI
   Assistant accepting caption- or footnote-only rows (`fa47167c`), and
   paragraphs in the Review and History tabs (`2820f13d`). The first browser
   CI run failed the Preview double-click test, because the paragraph margins
   moved its row near the bottom of the Preview; the translate anchor is now
   held to the top half of the scroll area (`d4212627`).
2. Synchronize npm, Tauri, Cargo, both lockfiles, and bundled notice versions to
   0.8.144. Add versioned notes.
3. Validate version agreement, locked Cargo metadata, formatting, tests, and lint.
   Publish the release PR from `claude/release-0.8.144` and merge after its
   quality/browser CI passes.
4. Push an annotated v0.8.144 tag at the release merge commit to trigger signed
   builds. Hans asked for this release on 2026-11-03.
5. Monitor macOS Apple Silicon, macOS Intel, Windows, and note publication.
   Verify stable release assets, updater signatures, and latest.json version and
   platform URLs.
