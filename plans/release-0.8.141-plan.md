# Release 0.8.141

1. Start from `claude/release-0.8.140` at `6a810dbb`: 36 commits after the
   v0.8.140 merge (`cddd3f4b`), made directly on that branch and not yet on
   main. They cover the editor toolbar, Cmd+S and AI Assistant shortcuts,
   per-chapter hidden languages, the target glossary gap marker, and Glossary
   Research changes (Run or Skip countdown, report-only steps continuing,
   step 2b and unmatched-meaning choices, and steps 8 and 9 testing and human
   review).
2. Synchronize npm, Tauri, Cargo, both lockfiles, and bundled notice versions to
   0.8.141. Add versioned notes.
3. Validate version agreement, locked Cargo metadata, formatting, tests, and lint.
   Publish the release PR from `claude/release-0.8.141` and merge after its
   quality/browser CI passes.
4. Push an annotated v0.8.141 tag at the release merge commit to trigger signed
   builds. Hans asked for this release PR on 2026-10-30.
5. Monitor macOS Apple Silicon, macOS Intel, Windows, and note publication.
   Verify stable release assets, updater signatures, and latest.json version and
   platform URLs.
