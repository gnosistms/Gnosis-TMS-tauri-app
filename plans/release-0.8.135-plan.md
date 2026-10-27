# Release 0.8.135

1. Merge the requested feature/fix PRs, including the two incoming fixes, before
   submitting the release: #382–#388 are now merged into main at 603d01df.
2. Prepare the clean release branch from that complete main. Synchronize npm,
   both lockfiles, Tauri, Cargo and bundled notice versions to 0.8.135; document
   the combined changes in docs/releases/v0.8.135.md.
3. Repair the export regressions discovered in Linux/Windows CI. Let book-scoped
   renders bypass the projects no-op guard and record their rendered state, so
   re-including chapters refreshes contents and Back restores footnote controls.
   Wait for asynchronous image import before measuring caption geometry in its
   browser test.
4. Validate the release, publish and merge its focused PR after quality/browser
   checks pass, then push annotated tag v0.8.135 at the exact main merge commit.
5. Monitor the signed macOS Apple Silicon, macOS Intel and Windows release jobs,
   plus release-note publication. Verify stable assets, updater signatures and
   latest.json version/platform URLs. Leave local installation to the user.

## Local validation

- All seven version fields agree on 0.8.135; the development version guard passes.
- All 3,206 frontend tests and 25 workflow tests pass.
- All 63 export/projects browser tests pass, including both CI regressions.
- The caption test passes ten consecutive runs after waiting for image import.
- JavaScript lint, production build, locked offline Cargo metadata, Rust format
  and whitespace checks pass.
- The unused-code audit exactly matches main's existing 41-file baseline.
- Notices were regenerated; after preserving LF, their only change is the app
  version. Dependencies are unchanged.

Unrelated dirty development work is preserved in its original checkout. Native
CI and signed release builds run in GitHub Actions; no local release is installed.
