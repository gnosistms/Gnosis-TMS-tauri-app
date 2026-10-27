# Keep editor drafts out of background commits

## Problem

The periodic editor sync flushes every dirty row through the normal Git save
path, including a focused textarea. Manual refresh also flushes drafts first.
Either can create history without a deliberate row save.

## Plan

1. Remove draft flushing from editor background sync. Keep its existing wait
   behavior while local drafts or pending writes prevent a safe sync.
2. Make manual refresh wait only for already requested editor operations, without
   submitting drafts. Preserve textarea focus when clicking Refresh.
3. Keep drafts in existing in-memory editor state across same-file reloads,
   including failed reloads; refuse a reload that would discard a dirty row or
   remove the language containing draft text.
   No Git commit or new durable storage is needed for an in-process refresh.
4. Add regression coverage for focused timer sync, delayed explicit saves,
   refresh waiting, draft-preserving reloads and reload failures. Run relevant
   tests, the unit suite and unused-export audit.

## Scope

Preserve existing deliberate blur/Shift+Enter and leave-editor save behavior.
This fixes editor sync and in-app refresh; it does not add crash recovery or
change application restart behavior.

## Navigation follow-up

1. Trace Projects, the glossary header and glossary-term double-click navigation.
2. Exercise each with a focused unsaved row in browser tests and verify that
   leaving submits the text. Fix any navigation path that loses the draft.
3. Recheck History/background-sync and refresh protections alongside navigation.

Verified: all three navigation actions save the focused draft exactly once without
Shift+Enter. Glossary shortcuts use the deferred blur scan; Projects also uses
the explicit leave guard. No additional production change was needed. Added three
browser regressions; all ten targeted navigation/draft/sync/refresh tests passed
in installed Chrome. `git diff --check` passed.

## Validation

Completed:

- App unit suite: 2,154 passed.
- Workflow suite: 23 passed with local-server permission (sandboxed run cannot
  start the dev-launcher test servers).
- Browser regressions: 12 passed using installed Chrome, including History with
  a focused draft, delayed deliberate saves, refresh under macOS/Windows UI
  settings, failed-refresh retry, and existing sync/focus/scroll regressions.
  These are browser platform settings, not a native Windows run.
- ESLint on changed app files and `git diff --check`: passed.
- Unused-code audit: compared against an isolated HEAD snapshot; same existing
  three unused files, five unresolved imports and one unused export. No new
  findings from this change.

The default Playwright browser binary was missing locally; validation used a
temporary config outside the repository to select installed Chrome.

## Review follow-up

1. Guard every blocking sync reload against live drafts before opening a modal,
   including imported conflicts received after the user starts typing. Retain
   deferred/failed reload requests in the editor sync session so they can retry.
2. Return an explicit success boolean from chapter loading and both public
   wrappers. Preserve the usable draft UI on failure without reporting success.
3. Make refresh respect deferred sync reloads and stop/report failure when its
   local reload fails. Verify deferred conflict handling, retry with an unchanged
   remote head, failure reporting and normal successful reloads.

Follow-up validation completed:

- App unit suite: 2,160 passed; workflow suite: 23 passed (local-server permission
  required for the workflow suite).
- Five targeted browser regressions passed, covering the new sync/refresh race,
  failed-refresh feedback and existing blocking/conflict reloads. The final
  failed-refresh assertion was rerun successfully after removing a test-only
  unresolved import.
- Unit regressions verify that deferred and failed reloads retry even when the
  next sync reports an unchanged head, and that successful reloads clear the
  pending request. The successful assistant-sidebar return path is covered too.
- Changed-file ESLint and `git diff --check` passed. The unused-code audit has
  the same existing findings recorded above, with no new findings.
