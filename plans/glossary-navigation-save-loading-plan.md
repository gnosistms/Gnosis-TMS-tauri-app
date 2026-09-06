# Preserve term lists when returning during a save

## Review follow-up

Completed. Saves capture the original team and repository; their completion and
rollback only patch a matching editor. Failed intents retain drafts for recovery
in the original glossary, and retry/cancel clears the corresponding failed intent.
Glossary and QA activity guards are repository-scoped, with initial loads waiting
for their own writes to settle. The editor QA shortcut delegates to the common
opening flow. Successful glossary deletion removes the confirmed row directly
through the existing term-update helper and invalidates the original query.

1. Bind glossary save preflight, completion, rollback, and failed-draft recovery
   to the captured team/repository. Keep failed intents recoverable on return.
2. Scope active-write snapshot guards to the requested glossary. Resume initial
   loads after that repository's writes settle without blocking other glossaries.
3. Route the editor QA shortcut through the common opening path.
4. Apply confirmed glossary deletion to the matching visible editor and invalidate
   its query, preserving other edits and handling navigation during deletion.
5. Promote the review reproductions to regression tests; cover return/retry and
   run the relevant and full frontend checks.

Follow-up validation:

- 56 glossary/QA background-sync tests passed, including the review reproductions,
  failed-draft recovery/retry/cancel, queued saves after navigation, cross-team
  completion, cold return during save, and deletion with another draft open.
- Full frontend app/screen suite: 2,099 passed. Changed-file ESLint, build, and
  `git diff --check` passed.
- Workflow suite still has the same four unrelated dev-launcher startup failures
  (13 passed). Unused-code audit findings are unchanged from the original fix.
- Native application was not rebuilt or manually exercised.

## Problem

Reopening the glossary resets its ready editor to an empty loading state. The
snapshot guard rejects cached and disk data while a term save or sync is active,
and save completion only patches terms, leaving the editor status loading. QA
lists have the same reset/guard combination.

## Plan

1. Check the Rust glossary load path and its storage tests, then reproduce the
   navigation/save overlap with controlled asynchronous frontend tests.
2. Preserve the ready term list (including pending edits) when priming and loading
   the same glossary or QA list. Keep normal loading when changing resources and
   retain the existing protections against overwriting drafts and active saves.
3. Test return navigation during save, save completion/failure, sync overlap, and
   switching resources; run related unit tests and frontend validation.

## Result

Both editor flows now retain a ready snapshot when the resource ID and repository
match, through both priming and disk loading. QA direct-open also retains its
snapshot and search text. Existing snapshot guards still protect active edits;
switching resources still starts with an empty loading state.

## Verification

- Before the fix, all six return-during-write regression cases failed with
  `loading` instead of `ready`; they now pass. Glossary tests use the real save
  flow with a deferred IPC response and cover both save success and failure.
- Ten new cases cover glossary and QA entry paths, resource switches, and
  deferred background sync. All 43 glossary/QA background-sync tests pass.
- Rust glossary storage tests: 8 passed. The editor load command reads metadata
  and active term files from disk without waiting for remote sync.
- Full frontend app/screen suite: 2,084 passed (before the final two sync tests
  were added and verified in the focused suite). Build and changed-file ESLint
  passed.
- `npm test` then reached the unrelated workflow suite: 13 passed, 4 existing
  dev-launcher cases failed because their grandchild server did not start.
- Unused-code audit reports only untouched files/exports: two benchmark scripts,
  the existing untracked launcher installer, browser app-update imports, and
  `ensureEditorFootnoteEntry`. No findings in the changed modules.
- Native UI navigation was not manually exercised; the race is reproduced with
  controlled asynchronous frontend tests.

## PR validation

On an isolated checkout of current `main`, the full frontend and workflow suites,
full JavaScript lint, and production frontend build pass. The unrelated local
dev-launcher files are excluded from this PR.
