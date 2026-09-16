# Release 0.8.111

Release the merged editor and export improvements after v0.8.110: PR #320
(clearer export label), PR #321 (preserved undo history across virtualized rows),
and PR #322 (stable scrolling when closing a footnote under the glossary-error
filter).

1. Prepare a focused version bump for the npm, Tauri, Cargo, lockfile, and bundled
   notice metadata, and add user-facing release notes.
2. Verify version consistency and run the focused release checks in a clean worktree.
3. Open and merge the release PR after its required checks pass.
4. Tag the merged release commit `v0.8.111` and push it to trigger the signed macOS
   and Windows builds.
5. Verify the completed release workflow, platform artifacts, updater metadata, and
   published release notes.

This release is based on `origin/main` at `db787252`, preserving unrelated work in
the primary checkout.
