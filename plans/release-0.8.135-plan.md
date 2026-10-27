# Restore the missing attribution prompt style and release 0.8.135

## Cause and scope

The requested smaller italic empty-attribution prompt remained in the local
working tree and was excluded from the project-export PR and v0.8.134. The
release still uses a normal-style prompt at 90% of the body font size.

1. Apply just the prompt typography: italic, at 72% of body size (20% smaller
   than the previous 90% prompt). Keep the existing attribution field typography.
2. Extend the existing browser regression to check the rendered size and italics,
   while retaining click/focus, typing, undo, clearing and saved-content checks.
3. Synchronize the six release metadata files to 0.8.135, add notes, validate the
   frontend/build/version/workflow checks, and merge a focused PR after hosted CI.
4. Tag the merge commit, wait for all signed release builds and notes, and verify
   installers, updater platform URLs and signatures before reporting completion.

Other pending editor changes stay in the original checkout. Use an isolated
main-based worktree so only this requested typography fix is shipped.

## Validation

- Both focused attribution browser checks pass, including the rendered italic
  prompt at 80% of the attribution field's size, editing, undo, saving and preview.
- The browser screenshot visibly confirms the smaller italic click prompt.
- All 3,042 frontend tests and 25 workflow tests pass.
- Production frontend build, locked offline Cargo metadata and the development
  version guard pass. Regenerated notices differ only by the application version.
