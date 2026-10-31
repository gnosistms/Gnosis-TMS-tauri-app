# Release 0.8.142

1. Start from `claude/release-0.8.140` at `7e70ea91`: 8 commits after the
   0.8.141 release base (`6a810dbb`), made directly on that branch and not yet
   on main. They cover the EPUB title page (one-line title, PDF-sized logo),
   reusing downloaded export images across formats, and Glossary Research
   changes (step descriptions, suggested meanings for step 6 translations that
   fit none, plain definitions, 2a reruns on re-research, step 6 guidance
   removed, CSS-drawn checkboxes). Merge main (`72ff81de`, v0.8.141) into
   `claude/release-0.8.142`.
2. Synchronize npm, Tauri, Cargo, both lockfiles, and bundled notice versions to
   0.8.142. Add versioned notes.
3. Validate version agreement, locked Cargo metadata, formatting, tests, and lint.
   Publish the release PR from `claude/release-0.8.142` and merge after its
   quality/browser CI passes.
4. Push an annotated v0.8.142 tag at the release merge commit to trigger signed
   builds. Hans asked for this release on 2026-10-31.
5. Monitor macOS Apple Silicon, macOS Intel, Windows, and note publication.
   Verify stable release assets, updater signatures, and latest.json version and
   platform URLs.
