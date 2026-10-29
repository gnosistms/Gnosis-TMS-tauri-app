# Release 0.8.139

1. Start from main at `68cc1439`, containing the only merge since v0.8.138:
   #411 (table of contents preview typeset by Typst, with estimated page numbers
   and a Rendering spinner on the title and contents pages).
2. Synchronize npm, Tauri, Cargo, both lockfiles, and bundled notice versions to
   0.8.139. Add versioned notes covering #411.
3. Validate version agreement, locked Cargo metadata, formatting, tests, and lint.
   Publish a focused release PR and merge after its quality/browser CI passes.
   Main's post-merge CI for #411 failed on two tests that passed on the PR
   (a Linux "text file busy" Git runtime test and a Windows glossary hover
   timeout); rerun them to confirm they are flaky.
4. Confirm main includes #411 and the version bump. Push an annotated v0.8.139
   tag at the release merge commit to trigger signed builds. Hans asked for this
   release on 2026-10-29.
5. Monitor macOS Apple Silicon, macOS Intel, Windows, and note publication.
   Verify stable release assets, updater signatures, and latest.json version and
   platform URLs.
