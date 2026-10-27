# Merge requested pull requests

Scope: merge #259, #350, #353, #354 and #377 into main, preserving unrelated local work and without publishing a release.

1. Verify current PR heads and CI in an isolated checkout. Merge validated compatible PRs.
2. Update conflicting branches from main and resolve against the current renderer/runtime architecture.
3. Run application/workflow tests, relevant browser regressions, build/lint/unused audit and native footnote checks. Push resolutions to existing PR branches and verify GitHub checks before merging.
4. Confirm all five PRs merged and resulting main status. Preserve the original working tree.

Progress: #377 and #353 merged after successful quality and browser workflows.
