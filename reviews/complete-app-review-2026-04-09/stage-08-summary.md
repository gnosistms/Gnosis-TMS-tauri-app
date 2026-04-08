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
