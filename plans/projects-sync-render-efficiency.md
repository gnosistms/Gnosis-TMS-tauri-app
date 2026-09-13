# Projects sync render efficiency

The projects page replaces its DOM and virtual-list controller on full renders.
Repository sync polls every 1.4 seconds per repository, publishing and rendering
even when the backend returns the same stored snapshot. Discovery's query
publisher and the sync flow also both render each published update.

## Plan

1. Verify the backend snapshot contract and trace render ownership through sync,
   discovery, and the query publisher.
2. Skip unchanged poll publications while preserving stall detection and changed
   snapshot delivery. Let the sync flow render once after query-layer publication.
3. Add regression coverage for unchanged polls, changed snapshots, and stalled
   syncs; run relevant tests, the unit suite, and unused-export checks.
4. Review follow-up: render the final snapshot after badge updates so an engaged
   dropdown retains the full render. Cover both successful and failed syncs with
   the real render-hold controller, then rerun focused tests and lint.

## Verification

- Review follow-up fixed: the final full render now follows status updates.
  Both success and error dropdown regressions failed before the fix and pass
  after it; all 69 focused sync/discovery/query/render-hold tests and ESLint pass.
- Implemented: identical polls no longer publish or render; discovery lets the
  sync flow own the single render after each repo snapshot publication.
- All 2,166 frontend tests passed, including regressions for duplicate discovery
  renders, unchanged polls, changed snapshot details, and stall detection.
- All 23 workflow tests passed across the initial run and a rerun of the four
  launcher tests outside the sandbox (they require a temporary localhost port).
- ESLint for changed files and `git diff --check` passed.
- The unused-code audit reported three unused scripts, five unresolved browser
  fixture imports, and `ensureEditorFootnoteEntry`; none are in changed files.
- Backend `list_project_repo_sync_states_sync` returns the stored snapshot while
  a sync is running; polling itself does not create new progress information.
- Collection changes continue through the injected query-layer publishers.
- Native momentum scrolling on macOS and Windows requires manual verification;
  automated checks establish render counts and state delivery.
