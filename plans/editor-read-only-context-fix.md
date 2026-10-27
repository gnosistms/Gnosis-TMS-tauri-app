# Prevent unexpected read-only chapter rendering

## Goal

Keep a writable chapter editor usable across background project refreshes while
preserving membership and deleted-resource write checks.

## Investigation

The running 0.8.132 app showed chapter text without edit buttons, row actions, or
its linked glossary navigation. The toolbar still offered write actions. Local
team and native access records both identified the user as owner with writes
allowed. Returning to Projects and reopening the same chapter restored editing.
This narrows the failure to project/chapter context or lifecycle state, rather
than a native membership denial (which also disables toolbar writes).

## Steps

1. Trace native discovery payloads and every query/state path that can replace the
   active chapter's context; reproduce the transition in a regression test.
2. Fix the responsible state ownership/refresh boundary without bypassing query
   snapshots, membership checks, or explicit deletion state.
3. Run focused regressions, the frontend suite, unused-export audit, and build;
   record the root cause, validation, and any remaining delivery limitations.

## Root cause

Project discovery intentionally stops when its screen, team, request, or mutation
version becomes stale. Its early return contains the partial load result, which
may still be empty. The query wrapper checked only cancellation and selected team,
so leaving Projects could turn that early return into a successful empty query
snapshot. The observer then replaced the live project collection. The existing
context-preservation guard protected the Translate screen but not a chapter
temporarily suspended on its linked glossary or QA list.

Row editing requires a live project/chapter context in addition to the editor's
saved role snapshot. Removing that context hides edit controls and linked glossary
navigation while the toolbar still sees a writable permission snapshot. This
reproduces the reported screen without any change to owner access.

A second path allowed the final asynchronous disk rescan to publish progress after
navigation. Also, rejecting a stale query alone was insufficient: its error
notification replayed the previous completed cache, which can be older than the
progress snapshot already on screen.

## Implemented

- Gate progress publications and successful query results on the current screen,
  team, authentication generation, mutation version, and cancellation signal.
- Mark a discovery as abandoned before asynchronous cleanup so a quick return to
  Projects cannot make its partial result valid again.
- Discard stale-query observer notifications without replaying old cache data;
  finish refresh feedback while retaining the live project context.
- Keep capability checks, deleted-resource checks, and the query state boundary.

## Verification

- The original code failed the new glossary/QA navigation race regressions.
- Eight new cases cover navigation during the initial local scan and final disk
  rescan (Translate, glossary, and QA), returning during stale cleanup, and a
  legitimate completed empty collection. They use the real query observer and
  editor view model with mocked native command responses.
- Focused discovery/query/editor checks: 91 passed. Existing viewer and deleted
  resource restrictions remain covered.
- Frontend suite: 3,015 passed. Workflow suite: 25 passed outside the sandbox;
  the sandbox prevents the launcher child-process tests from starting normally.
- Production web build succeeds. Changed-file ESLint has no errors and one
  pre-existing unused-import warning. `git diff --check` passes.
- The unused-code audit exits nonzero on the baseline too. Compared JSON reports
  against HEAD: identical unused files and issues after normalizing source
  positions and ordering; no regressions.

The fix is in source. The installed desktop app needs a rebuilt version to include
it; this task does not replace the running app or publish a release.

## Review follow-up

The review reproduced a return-navigation gap: `loadTeamProjects()` can join an
abandoned query still in asynchronous cleanup, swallow its stale-result error,
and finish without a fresh discovery. Update that loader to retry stale results
while the same Projects page, team, and authentication session remain current.
The loader now retries a stale-result rejection while the same Projects screen,
team, and authentication generation remain current. It reuses the query cache's
normal request deduplication and leaves all progress/snapshot guards in place.

Four additional regressions exercise the real `loadTeamProjects()` call during
abandoned-query cleanup. The return case failed before the change and now starts
a second discovery, renders fresh data, and finishes successfully. Leaving the
screen, switching teams, or changing the authentication generation prevents a
retry. The test observer is unsubscribed before the shared query-cache teardown.

Follow-up validation: 95 focused tests passed; all 3,019 frontend tests and 25
workflow tests passed. Production web build and `git diff --check` passed. ESLint
has no errors (existing unused-import warnings only), and the unused-code audit
has the same files and findings as the HEAD baseline.
