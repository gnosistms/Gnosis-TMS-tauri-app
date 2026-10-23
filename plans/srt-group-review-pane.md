# Review complete subtitle groups

1. Load the selected language's field history for every member of the active
   subtitle group through the existing Rust history command. Retain the ordinary
   selected-fragment history for the History tab. Guard stale responses by
   chapter, selection, request, view mode, and ordered group membership.
2. Build a pure combined Last update model and show a sentence-wide diff in the
   Review tab, including pending/current text and each fragment's attachments.
   Combine each fragment's own latest meaningful update and its own baseline,
   as confirmed by the user. Keep standard rows intact.
3. Remove the fragment selector from Review while keeping it in History. Verify
   that both AI review modes send the complete group, use every member ID, retain
   blank cue assignments, and reject stale changes before Apply.
4. Add focused unit and browser regressions for history aggregation, loading and
   errors, selection/regrouping, AI requests/results, and selector visibility.
   Run the relevant checks and production build.

Status: complete.

- Review combines each fragment's latest meaningful change into one sentence-wide
  diff, retaining per-fragment authors, timestamps, attachments, blank cues, and
  pending/current text. Marker/comment-only revisions do not hide content changes.
- History loads all group members with at most four concurrent reads, rejects
  stale requests after selection/regrouping, and reports partial failures without
  disabling the selected fragment's History tab. Saves to any active group member
  refresh the combined history, including when the first fragment is unchanged.
- The fragment selector remains in History and is removed from Review. Existing
  AI grammar/full review requests already contain complete source/target sentences
  and every cue ID; suggestions now also display as one sentence-wide diff.
- Verification: 2,978 frontend tests, 25 workflow tests, and eight focused browser
  regressions pass. The preceding full subtitle browser run passed all 38 existing
  cases; two new test expectation issues were corrected and verified in the focused
  rerun. Production build and whitespace checks pass. Scoped ESLint has no errors
  and retains existing warnings; unused-audit counts remain 345 files, five imports,
  and 32 exports. The combined pane was visually inspected from a browser screenshot.
- AI responses are mocked in browser tests; no live AI calls or native platform
  verification were performed.
