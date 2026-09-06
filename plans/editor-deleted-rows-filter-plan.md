# Editor deleted rows filter

Add a “Deleted rows” option to the editor filter dropdown. It shows only deleted
rows, directly visible regardless of collapsed deleted sections, and combines
with search. Preserve existing filters, conflict locking, and row permissions.

1. Add the filter option and lifecycle matching to the existing filter pipeline.
2. Show matching deleted rows without collapsed group wrappers.
3. Verify filtering, search, and screen rendering with focused regression tests.

Completed all three steps.

Validation: 2,100 frontend unit tests passed; the focused Chrome browser test
passed for dropdown selection, collapsed-row visibility, search, restoration,
and returning to Show all. Changed JS files passed ESLint and diff checks.
Before PR creation, validation was repeated in an isolated worktree on the
latest main: the full npm test command and focused Chrome test passed. The
unused-code audit reported only findings outside the changed files.
