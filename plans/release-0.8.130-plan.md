# Release 0.8.130

1. Prepare the next patch release from main after PRs #366, #367, and #368.
   Preserve the active development checkout and its unrelated changes.
2. Synchronize package, lockfile, Tauri, Cargo, and notices versions; write
   release notes for glossary popup grouping, complete target-text AI Assistant
   review, and smart quotes on editor blur.
3. Validate metadata, locked Cargo dependencies, workflow tests, and the
   production frontend build; open and merge the focused release PR after
   its required quality checks pass.
4. Tag the release merge commit v0.8.130 and push the annotated tag. Monitor
   all three signing/build jobs and verify published assets, versioned release
   notes, and the updater manifest.

Publish through the repository's GitHub release workflow. Local installation
is outside this release task.

## Validation

All package, lockfile, Cargo, Tauri, and notices versions agree on 0.8.130.
Regenerating notices changed only the app version. Locked offline Cargo metadata,
the development version guard, all 25 workflow tests, and the production frontend
build passed. The merged feature changes passed the full frontend/native quality
gate and six focused browser regressions in PR #368.
