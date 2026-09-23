# Editor glossary refresh after local persistence

## Scope

Keep the existing remote preflight, serialized writes, push, and rollback policy.
Release translation-editor glossary reads once pending saves have persisted locally,
without waiting for their push. Reload an open linked glossary after local writes
and after final sync/rollback. Do not change resource collection state or QA saving:
QA lists have no linked translation-editor resource consumer to update.

## Implementation

1. Track local persistence separately from full glossary write completion in the
   existing term-write coordinator; preserve full-settlement waits for other callers.
2. Notify the editor at local persistence and final settlement (including term
   deletion), using scoped local
   revisions to reject obsolete reads. Guard refreshes by team, chapter, and link.
3. Refresh glossary highlights and sidebar without remounting editable fields;
   existing matcher identity and glossary revision keys invalidate cached results.
4. Cover delayed push, rollback, queued saves, stale reads, and navigation with
   regression tests. Run unit tests and unused-export audit.

## Review follow-up

1. Refresh the linked glossary asynchronously on the pending-write chapter-resume
   path, retaining rows, dirty state, and active field state.
2. Check local revision changes on failed reads as well as successful reads;
   only the newest refresh generation may publish its result.
3. Promote both review reproductions to permanent tests, including both failure
   completion orders and resume after an off-screen rollback.

Implemented all three steps. The resume path opens immediately and refreshes only
the glossary; tests verify rows, dirty-row tracking, and active field state keep
their identities. Failed reads now retry when their revision is obsolete, and
only the newest refresh generation publishes a result.

Follow-up validation:
- Both original review failures and the off-screen rollback reproduction failed
  before the fixes and pass afterward. Both failure completion orders are covered.
- Focused glossary/editor tests: 110/110 passed.
- Full application suite: 2,268/2,268 passed.
- Workflow tests: 19/23 passed in the sandbox; the four local-server launcher
  tests passed when rerun with local server access.
- Changed-file ESLint, production build, and whitespace checks passed. Build
  retains its large-chunk warning; unused-code audit findings are unchanged.
- Native interaction remains untested manually.

## Initial validation

- Implemented: local persistence releases translation-editor readers while the
  push continues; full-settlement waits remain unchanged for glossary screens.
- New regression coverage exercises delayed pushes, successful remote merges,
  rollback, deletion, queued versions, preflight failure, stale disk reads, and
  navigation across teams/chapters/links/screens.
- `npm test`: all 2,263 application tests passed at the full-suite checkpoint.
  The workflow suite passed 19/23 tests inside the sandbox; all four launcher
  server tests passed when rerun with local server access.
- Final focused run after coordinator cleanup and deletion coverage: 106/106
  tests passed (glossary writes, glossary sync, editor sync).
- ESLint passed for all changed JS files; `git diff --check` passed.
- Production frontend build passed, with the existing large-chunk warning.
- Unused-code audit reports only findings outside this change: three existing
  scripts, five browser-test absolute imports, and `ensureEditorFootnoteEntry`.
- Native macOS/Windows interaction was not manually exercised.
