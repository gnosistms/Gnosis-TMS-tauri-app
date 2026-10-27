# Repository identity when opening a linked glossary

The chapter link supplies only a glossary ID and repository name. The local editor
payload also omits repository identity, so opening a term directly from the chapter
never populates `fullName`. The existing save guard correctly blocks this state.
The team's local metadata record already contains the authoritative full name.

1. Stop release 0.8.107 and return its partial publication to draft (done).
2. Hydrate missing repository identity through the shared editor query from the
   matching local metadata record, checking both resource ID and repository name.
   Apply the query payload identity to glossary and QA editors for parity.
3. Reproduce chapter-link navigation with no populated glossary collection, edit
   only a footnote, and verify the save/sync inputs and stable term ID. Cover
   incomplete summaries, mismatched metadata, and stale navigation results.
4. Run focused and full frontend checks. Leave release stopped for user review.

Keep the existing save identity guard and backend validation. Do not infer remote
paths from team names, mutate local user data, or resume publishing.

## Results

- The shared glossary/QA editor query now reads missing identity from the local
  metadata record matched by ID, and rejects conflicting repository names/IDs.
  Editor snapshot application retains this identity for subsequent writes.
- The actual `open-editor-glossary-term` action exposed a second race: background
  sync can replace an editor state object during the asynchronous modal-open
  check. The check now compares resource context, so a refresh of the same glossary
  does not cancel opening the term; navigation to another resource still does.
- Both chapter-navigation regressions reproduce the screenshot's exact message
  when metadata hydration is disabled, and save the existing term when enabled.
- 2,151 frontend tests passed; all 23 workflow tests passed outside the sandbox
  after four launcher tests could not bind localhost in the sandbox. Focused
  regression tests, changed-file ESLint, and Vite production build passed.
- Unused-code audit findings are unchanged (3 files, 5 imports, 1 export).
- Release workflow 34315453698 is canceled. Its partially published 0.8.107 release
  was returned to draft. No new native build was installed or published.
