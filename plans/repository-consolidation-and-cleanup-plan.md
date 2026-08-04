# Repository Consolidation and Cleanup

## Goal

Publish all substantive uncommitted work, merge it into `main`, preserve recovery
until verification completes, and then remove stale worktrees, merged branches, and
rebuildable caches that are consuming local disk space.

## Work streams

1. Split and publish the main worktree changes as focused PRs:
   - AI Review footnote marker integrity;
   - Traditional Chinese TMX language-tag preservation;
   - WordPress post-search relevance/case normalization;
   - live-process protection in the Rust build-cache guard.
2. Finish and publish the glossary matcher `globalTrie` policy flip from its separate
   worktree, including cache-key invalidation and fixture/test updates.
3. Account for every other dirty worktree by proving its substantive changes are
   already merged or stale before removal.
4. Merge each green PR into `main`, update the local development branch, and verify
   the consolidated tree.
5. Remove clean/fully-accounted-for worktrees and merged branches, prune stale remote
   refs, expire obsolete recovery data only after all work is on `main`, and clear
   rebuildable Rust build caches when no running process uses them.

## Safety rules

- Never stage unrelated files together merely because they share a worktree.
- Keep the current dirty state recoverable until the corresponding PR is merged.
- Do not delete a dirty worktree unless every changed hunk is either merged, stale
  release metadata, or separately preserved in a commit.
- Check for live binaries before clearing any Rust `target` directory.
- Report reclaimed disk space from before/after measurements.
