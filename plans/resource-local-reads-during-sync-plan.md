# Local glossary and QA reads during git sync

## Finding

The frontend already releases linked-glossary reads after local saving, but
`load_gtms_glossary_editor_data` acquires the repository mutex held throughout
fetch/rebase/push. Its local refresh can therefore wait for network sync.

## Implementation

1. Preserve a consistent local editor payload for the duration of resource sync,
   captured under the existing repository lock before network work starts.
2. Let glossary and QA editor reads use that snapshot while sync owns the lock;
   otherwise read the working tree under the lock. Keep recovery, writes, and
   rollback serialized. Remove snapshots on every sync exit, including failure.
3. Exercise native local reads with the sync lock held, snapshot cleanup, scope
   isolation, and a reader arriving before snapshot publication. Run focused Rust
   and existing frontend glossary regression tests.

The snapshot is local data, scoped to one checkout and one active sync. It never
changes resource collection state or the existing save/preflight/rollback policy.

## Completed and verified

- Shared sync captures a local payload before transport credentials, fetch,
  rebase, and push. A scoped guard removes it on success and failure.
- Glossary and QA editor commands use that payload while sync owns the lock;
  disk reads and glossary recovery remain serialized with local writers.
- Native tests cover typed payload reads during a locked checkout with invalid
  transient term files, late snapshot publication, repository isolation, error
  cleanup, and fresh reads after the guard exits.
- Rust resource sync/storage tests: 29 passed. Glossary storage: 20 passed.
  QA storage: 11 passed. Frontend glossary sync/write tests: 85 passed.
- Rust formatting and whitespace checks passed. Native UI behavior was not
  manually exercised; the app needs rebuilding to use this backend change.

## Follow-up: stale hover after returning from glossary

Reproduce the complete browser sequence (editor → glossary → edit → save →
back → hover), including a save in progress and notes/footnote changes. Check
the rendered hover payload as well as editor state, fix the demonstrated cause,
and preserve field/scroll state and rollback behavior. QA parity applies to
shared loading/saving changes; the linked glossary hover is editor-specific.

### Follow-up findings and fixes

- Returning through the glossary's Back button reloads the chapter with visible
  rows preserved and status `refreshing`. Local glossary save notifications
  previously rejected that status, so notes stayed stale until the chapter load
  finished. The browser regression reproduced the old translator note and
  footnote while the chapter response was held.
- Refresh local glossary data independently at the start of a preserved-row
  chapter reload, and accept glossary updates while that chapter is refreshing.
  Existing context guards still reject another team, chapter, or link.
- Reposition/refresh an open tooltip after replacing its glossary marks so a
  stationary pointer also sees the new notes.
- Include footnotes and target-variant notes in derived glossary revision keys.
  Both new revision tests failed before the fix. Note-free legacy keys keep
  their existing representation.
- Browser coverage now exercises editing translator notes and footnotes via
  the UI, returning during push, returning with a held chapter response, keeping
  the pointer stationary as saving completes, and returning after an off-screen
  local save. All three refresh cases and five existing entry tests pass.
- Validation: 3,036 application unit tests passed; all 25 workflow tests passed
  across the sandbox run and the launcher rerun with process/server access.
  Eight browser tests passed using installed Chrome and a fresh Vite server on
  port 1433. Changed-file ESLint, whitespace checks, and production build passed
  (existing large-chunk warning). Native app interaction remains untested.

## Blocking review follow-up: editable pre-sync snapshots

An editable glossary opened during batch sync could receive old terms, then
run its own sync after HEAD had already advanced. That sync reported no changes,
leaving an old draft able to overwrite newer remote wording on a footnote edit.

1. Make current, synchronized data the default for glossary and QA editor loads.
   Add an explicit shared read mode for read-only consumers that may use the
   pre-sync local snapshot. Only the translation editor opts into that mode.
2. Exercise both read modes under the same held native sync lock, checking that
   editable reads wait and return post-sync data while read-only reads remain
   immediate. Verify omitted read modes select current data in both domains.
3. Promote the overwrite reproduction to a regression: open during batch sync,
   edit only a footnote, and retain the remote translation. Keep the editor's
   local refresh browser regressions passing. Run relevant Rust and frontend
   checks without changing the separate comment fixes.

### Review fix completed

- Added shared `EditorDataReadMode`: omitted modes default to `latest` in both
  glossary and QA commands. Editable queries therefore acquire the repository
  lock and read the current working tree after sync completes.
- Only `loadEditorGlossaryState` opts into `localSnapshot`; its hint/highlight
  consumers remain responsive during fetch/push. These payloads do not enter
  the editable resource query cache.
- Native coverage tests a read-only and editable reader against the same held
  lock and pre-sync snapshot. Read-only data returns immediately; the editable
  reader waits and returns the remote wording written before releasing the
  lock. Both command input types also test the safe default.
- Promoted the footnote overwrite reproduction into frontend and browser
  regressions. Editing only the footnote preserves the newly synced target.
- Verification passed: 62 focused Rust tests; 109 focused frontend tests;
  3,046 application tests; nine browser tests. All 25 workflow checks passed
  across the sandbox run and launcher rerun with local server/process access.
  ESLint, Rust formatting, whitespace checks, and frontend build passed.
- Unused-code audit matches the preceding audit except for shifted browser-test
  line numbers; no new findings. The existing build chunk-size warning remains.
  Native app interaction remains untested, and the native app must be rebuilt
  to use the new read-mode contract.
