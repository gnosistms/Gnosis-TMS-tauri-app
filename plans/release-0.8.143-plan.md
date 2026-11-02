# Release 0.8.143

1. Start from `claude/release-0.8.140` at `1a9753d3`: 6 commits after the
   0.8.142 release (`4abf5efe`), made directly on that branch and not yet on
   main. They cover the Translate All fix that stops batch saves from erasing
   the file's other languages (data loss since 0.8.132, reported on the Runes
   project), returning to the chapter when a term window opened from the editor
   closes, the AI Review "Identify parts that are difficult to understand"
   option and its glossary-term context, and two step 9 questions about
   unapproved and other-meaning translations. The branch already contains
   v0.8.142, so no merge of main is needed.
2. Synchronize npm, Tauri, Cargo, both lockfiles, and bundled notice versions to
   0.8.143. Add versioned notes.
3. Validate version agreement, locked Cargo metadata, formatting, tests, and lint.
   Publish the release PR from `claude/release-0.8.143` and merge after its
   quality/browser CI passes.
4. Push an annotated v0.8.143 tag at the release merge commit to trigger signed
   builds. Hans asked for this release on 2026-11-02.
5. Monitor macOS Apple Silicon, macOS Intel, Windows, and note publication.
   Verify stable release assets, updater signatures, and latest.json version and
   platform URLs.
