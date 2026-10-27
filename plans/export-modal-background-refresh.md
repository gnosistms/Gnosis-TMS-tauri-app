# Export dialog stability during project refresh

## Goal

Keep the mounted projects list and export dialog intact while project discovery/sync publishes progress.
At completion, redraw it at most once, and only if its project changed. Explicit
dialog actions, preview loading, and export progress must still render immediately.

## Approach

1. Mark renders originating from project loading/query observation/repository polling as background
   renders, retaining the query layer as the owner of collection snapshots.
2. Patch only the status surface during background refresh, then commit the final
   projects page once. Deduplicate repeated completion notifications. Preserve the
   existing export backdrop when its project is unchanged. Compare a stable snapshot of the exported project at completion,
   excluding transient discovery fields and unrelated projects/sync badges.
3. Keep existing projects dropdown and scroll protections. Verify DOM identity,
   focus/selection/scroll, no-op/unrelated refreshes, one changed-project refresh,
   and normal dialog actions with unit and browser regression tests.

## Status

Complete. Background query/discovery and repository-poll progress retain the
mounted page; status badges and migration/connection/update overlays patch
separately. Final HTML comparison deduplicates observer, loader-finally, and
navigation completion notifications. Export backdrops remain connected when a
stable snapshot of their project is unchanged, preserving drafts, focus,
selection, and scroll. Explicit user actions retain their immediate render path.

## Verification

- Full frontend suite: 3,122 unit/screen tests and 25 workflow tests passed.
- Final focused query, navigation, repository-sync and render tests: 64 passed.
- Ten distinct browser workflows passed across the runs, including redraw
  counts, no-op and unrelated updates, changed-project completion, selection and
  scroll retention, live migration progress, existing dropdown holds, rapid
  metadata selections, team scroll state, deletion during refresh, and exports.
- Production build and whitespace checks passed. ESLint has no new issues;
  unused-export audit lists no new module regressions (existing repository
  warnings remain).
