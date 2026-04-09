# Stage 8 Review: Cross-Cutting Risks, Testing Gaps, and Final Priorities

## New Findings

- No additional line-level defects beyond Stages 1 through 7. This stage summarizes the recurring risk patterns that showed up across the review.

## Cross-Cutting Themes

### 1. Capability and permission checks are still inconsistent across feature areas

- Team, project, file, and glossary actions do not all use the same capability model.
- The biggest user-facing risk from that inconsistency is that controls can appear or remain executable for users who should not be allowed to mutate the resource.
- The highest-priority examples are called out in:
  - [stage-03-teams-members.md](/Users/hans/Desktop/GnosisTMS/reviews/complete-app-review-2026-04-09/stage-03-teams-members.md)
  - [stage-04-projects-files.md](/Users/hans/Desktop/GnosisTMS/reviews/complete-app-review-2026-04-09/stage-04-projects-files.md)
  - [stage-05-glossaries.md](/Users/hans/Desktop/GnosisTMS/reviews/complete-app-review-2026-04-09/stage-05-glossaries.md)

### 2. The editor is functionally strong, but its complexity is now concentrated in a few critical reducers and orchestration paths

- The editor/history/virtualization stack is cleaner than it was before, but it has crossed the threshold where reducer-style logic needs tests, not just manual verification.
- The most important examples are:
  - language/source selection correctness in [stage-02-editor.md](/Users/hans/Desktop/GnosisTMS/reviews/complete-app-review-2026-04-09/stage-02-editor.md)
  - history loading and backend revision cost in [stage-07-backend-git-github.md](/Users/hans/Desktop/GnosisTMS/reviews/complete-app-review-2026-04-09/stage-07-backend-git-github.md)

### 3. Sync, recovery, and backend transport paths are still too eager or too expensive in a few important places

- A few backend/integration paths are doing more than they need to do, or reacting too aggressively to partial failures.
- The most important examples are:
  - over-aggressive `403/404` recovery in [stage-06-persistence-sync.md](/Users/hans/Desktop/GnosisTMS/reviews/complete-app-review-2026-04-09/stage-06-persistence-sync.md)
  - token exposure during repo sync in [stage-07-backend-git-github.md](/Users/hans/Desktop/GnosisTMS/reviews/complete-app-review-2026-04-09/stage-07-backend-git-github.md)
  - repeated full-row scans for project summaries in [stage-07-backend-git-github.md](/Users/hans/Desktop/GnosisTMS/reviews/complete-app-review-2026-04-09/stage-07-backend-git-github.md)

## Recommended Fix Order

1. Fix the access-control gaps first.
2. Fix the repo-sync token exposure next.
3. Add tests around editor-history reduction / virtualization selection logic before adding more editor features.
4. Reduce the expensive backend scans (`history` loading and chapter summary loading) before project size grows further.
5. Normalize persistence and recovery policy so storage, sync, and error handling do not keep diverging by feature area.

## Testing Gaps

- The editor history/grouping logic needs table-driven reducer tests.
- Capability gating needs scenario coverage at the flow level, not just manual UI inspection.
- Sync/recovery behavior needs explicit tests for `403`, `404`, offline, and stale-local-state cases.
- Backend performance-sensitive paths should have at least one regression benchmark or fixture-based smoke test for large chapter/repo sizes.

## Handoff Snapshot (2026-04-09)

- Repo locations:
  - desktop app repo: `/Users/hans/Desktop/GnosisTMS`
  - broker repo: `/Users/hans/Desktop/gnosis-tms-github-app-broker`
  - if the issue involves `/api/github-app/.../gnosis-glossaries`, the next thread should check the broker repo and deployment, not only this app repo.
- Broker status:
  - the glossary broker routes were added and pushed from the broker repo in commit `c5a73d0` (`Add glossary repo routes to broker`).
  - if production behavior still does not reflect those routes, the likely next step is deployment verification on DigitalOcean App Platform.
- Already committed in the desktop app repo:
  - glossary lifecycle and repo-backed glossary integration
  - glossary rollback safety fix
  - glossary term source-variant uniqueness enforcement in the modal + Rust save path
  - client fallback when glossary broker routes are missing
- Still local and uncommitted in the desktop app repo:
  - shared page-sync controller refactor, removing the separate Projects-only sync module
  - shared repo slug helper used by both projects and glossaries
  - Projects-page persistent glossary warning state instead of swallowed glossary-load failures
  - shared Rust repo-sync transport helpers used by both project and glossary repo sync modules
- Files to inspect first if a new thread needs to resume:
  - implementation plan for local-first sync + team metadata: [team-metadata-sync-implementation-plan.md](/Users/hans/Desktop/GnosisTMS/reviews/complete-app-review-2026-04-09/team-metadata-sync-implementation-plan.md)
  - broker repo entrypoint: [server.js](/Users/hans/Desktop/gnosis-tms-github-app-broker/src/server.js)
  - broker glossary routes: [glossary-routes.js](/Users/hans/Desktop/gnosis-tms-github-app-broker/src/glossary-routes.js)
  - broker glossary repo handlers: [glossary-repos.js](/Users/hans/Desktop/gnosis-tms-github-app-broker/src/glossary-repos.js)
  - broker repo property helpers: [repo-properties.js](/Users/hans/Desktop/gnosis-tms-github-app-broker/src/repo-properties.js)
  - app shared repo-sync transport: [repo_sync_shared.rs](/Users/hans/Desktop/GnosisTMS/src-tauri/src/repo_sync_shared.rs)
  - app project repo sync: [project_repo_sync.rs](/Users/hans/Desktop/GnosisTMS/src-tauri/src/project_repo_sync.rs)
  - app glossary repo sync: [glossary_repo_sync.rs](/Users/hans/Desktop/GnosisTMS/src-tauri/src/glossary_repo_sync.rs)
  - app project discovery/warning path: [project-flow.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/project-flow.js)
  - app project screen warning UI: [projects.js](/Users/hans/Desktop/GnosisTMS/src-ui/screens/projects.js)
  - app shared sync controller: [page-sync.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/page-sync.js)
  - [glossary-repo-flow.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/glossary-repo-flow.js)
  - [glossary-discovery-flow.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/glossary-discovery-flow.js)
  - [state.js](/Users/hans/Desktop/GnosisTMS/src-ui/app/state.js)
- Latest local verification before handoff:
  - `npm test`: passed
  - `npm run build`: passed
  - `cargo check`: passed
  - the usual non-blocking Vite warning about `state.js` dynamic/static import overlap still appears
