# Footnotes after returning from a glossary save

1. Verify the running dev process and local glossary history before changing the
   save lifecycle. The current process runs this checkout's latest native binary;
   recent footnote edits are committed locally and match the recorded origin HEAD.
2. Extend the existing browser reproduction to return during the preflight sync,
   check both source and target hovers, and check after the chapter reload completes.
   Keep push held to distinguish local persistence from remote completion.
3. Fix only a demonstrated cause, retain remote conflict and rollback protection,
   and run the focused regressions. Shared resource changes require QA parity.

## Results

- The running native process started at 18:41:56 on October 25 and maps the same
  executable inode as the current debug build (built at 18:34:35, after the native
  read-mode fix). Vite serves this checkout on port 1431.
- The recent Gran Arcano footnote edits are in local commits at 18:50 and 18:51;
  the local glossary branch matches its recorded origin branch. These edits were
  not cancelled by navigation.
- All five browser regressions pass. Coverage now includes returning during
  preflight, source and target hover text, and completed chapter reloads while
  the push remains held. ESLint and whitespace checks pass.
- The reported stale hover remains unreproduced. No application source was
  changed in this investigation, and the save/sync lifecycle was preserved.

## Follow-up after confirmation that glossary saves persist

Reproduce with a virtualized chapter and the real chapter's three-language
layout. Check whether visible marks, remounted rows, derived entries, or late
chapter responses can restore stale hover data. Add the failing case before
changing application code and preserve field state and viewport ownership.

### Reproduced cause

Returning to Translate waits for `refreshVisibleTeamAccess` before starting the
chapter load, which is where the local glossary refresh was started. A save
completed off-screen therefore leaves old glossary state visible while the
broker installations request is pending. Holding that request reproduces the
old translator note and footnote in a browser test despite new data on disk.

Refresh the read-only linked glossary immediately on entering Translate, before
the access check. Keep the existing access check before chapter loading and
background synchronization; no write permissions or editable resource loads
change. Test both navigation and ordinary chapter reload behavior.

### Fix and verification

- Translate navigation now starts the read-only local glossary refresh as soon
  as the editor is visible. A slow team-access request no longer gates hover
  metadata; chapter loading and synchronization retain their existing checks.
- The held-access regression failed before the fix with old translator notes
  and footnotes. It now checks source and target hovers before permitting a
  chapter load or push to finish, then checks the completed chapter reload.
- Extended the shared fixture to three languages and added a virtualized
  120-row return case. All 12 glossary entry/refresh browser tests pass.
- All 3,046 application tests, 107 focused tests, changed-file ESLint,
  whitespace checks, and the frontend production build pass. The build keeps
  its existing chunk-size warning. This change requires no native rebuild.
