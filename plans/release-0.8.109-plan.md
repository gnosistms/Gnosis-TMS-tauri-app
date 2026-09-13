# Release 0.8.109

Release the two successfully merged editor PRs: #314 (unsaved drafts during sync
and refresh) and #315 (Has glossary error filter, including review fixes).

1. Confirm both merge commits are ancestors of the release branch.
2. Bump npm, Tauri, Cargo, lockfiles, and the bundled notice version to 0.8.109.
3. Add release notes covering draft preservation and glossary-error filtering.
4. Validate version consistency, frontend build, and repository checks; open and
   merge a focused release PR after CI passes.
5. Tag the release merge commit as v0.8.109 and push the tag to trigger the existing
   signed macOS (Apple Silicon/Intel) and Windows release workflow.
6. Verify the completed workflow, published installers, updater metadata,
   signatures, and release notes.

Work in an isolated worktree to preserve unrelated local edits. Do not publish
or alter the older draft release v0.8.107.
