# Glossary display review fixes

1. Rebase ready derived entries for metadata-only glossary changes: verify that
   source/target forms and glossary identity did not change, retain each row's
   alignment, replace note/footnote/variant guidance, rebuild its matcher, and
   persist the updated entries. Apply this during local refresh and chapter loads.
   Preserve invalidation for changed wording, deleted terms, and already stale rows.
2. Mark native glossary and QA payloads that came from a sync snapshot. After the
   translation editor displays that immediate snapshot, start a current-data read
   using the existing latest mode. Apply it only to the same chapter/team/link and
   revision, with the existing in-place DOM refresh. Editable resource reads keep
   their current-data default. This avoids waiting for git in the initial display.
3. Promote the review reproductions into tests, including English hover metadata,
   persistence across chapter reload, sync completion, navigation/context changes,
   and structural glossary edits. Run focused native/frontend/browser tests, then
   the application suite and build. Preserve unrelated comment and CSS changes.

## Completed

- Added metadata reconciliation for ready derived entries with a matching prior
  revision and unchanged glossary identity/forms. It reuses the normal glossary
  matcher to resolve guidance (including case, punctuation, and merged variants),
  retains aligned source spans, updates notes/footnotes/variant notes, rebuilds
  matchers, and persists the updated cache. Wording/deletion changes and stale
  revisions remain invalid. Chapter loads reconcile stored entries too.
- Shared native reads now return the existing payload fields plus
  `syncInProgress`. The flag is true only for pre-sync snapshot data, and is
  available for both glossary and QA reads. Editable reads still default to
  current data. Native tests verify the flag and flattened payload for both domains.
- After displaying a snapshot, the translation editor starts a current-data read
  in the background. The existing team/chapter/link/revision guards control its
  application, and normal DOM patching refreshes stationary hovers. An initial
  failed local capture gets one current-data retry as well.
- Verification: 62 focused native tests, 108 focused application tests, all 3,058
  application tests, 13 refresh/entry browser tests, ESLint, whitespace checks, and
  the frontend build pass. Browser tests now retain English hovers after local
  saves and chapter reloads, and refresh an open hover after standalone sync.
  The build retains its existing chunk-size warning.
- The running dev process maps the rebuilt native executable's current inode.

## PR preparation on current main (2026-10-27)

- Isolated the glossary changes from the shared checkout on
  `codex/glossary-local-refresh`, based on current `origin/main` (0.8.134).
- Kept the separate comment-read, attribution, export, and research UI work out
  of this PR. Footnote editor padding is a separate focused commit.
- All 3,057 application tests and 25 workflow tests pass on this base, along
  with 62 focused native tests and the frontend build.
- Added Knip browser-path aliases for the new browser regressions. Compared
  with an exported copy of main, unused files (41) and exports (16) are unchanged;
  unresolved imports fall from seven to zero. ESLint has no errors.
