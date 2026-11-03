# Release 0.8.145

1. Cut `claude/release-0.8.145` from `origin/main` at the 0.8.144 release merge
   (`1656a51b`) and cherry-pick the close-wait freeze fix (`7e7b54fd` on
   `claude/release-0.8.140`): when the "Saving changes before closing" dialog
   finishes, the app quits directly instead of destroying the window, which
   could freeze it. Hans asked on 2026-11-03 to open the release PR now and
   add the next few days' changes before releasing. Cherry-pick each one from
   `claude/release-0.8.140` onto this branch and add it to the notes.
2. Synchronize npm, Tauri, Cargo, both lockfiles, and bundled notice versions to
   0.8.145. Add versioned notes.
3. Validate version agreement, locked Cargo metadata, formatting, tests, and lint.
   Publish the release PR from `claude/release-0.8.145`. Merge after its
   quality/browser CI passes, once Hans says the release is ready.
4. Push an annotated v0.8.145 tag at the release merge commit to trigger signed
   builds.
5. Monitor macOS Apple Silicon, macOS Intel, Windows, and note publication.
   Verify stable release assets, updater signatures, and latest.json version and
   platform URLs.
