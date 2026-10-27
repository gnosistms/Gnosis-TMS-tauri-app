# Glossary duplicate variant feedback

The backend can reject a source variant found on disk after sync even when the
editor's current list does not contain it. Its generic error then reopens the
draft with no redundant indices, so the message incorrectly promises highlights.

1. Return the exact conflicting source variants in a readable backend error.
2. Restore backend conflicts into the draft's existing inline feedback; keep them
   aligned when variants are edited, moved, or removed. Remove positional wording.
3. Verify backend conflict detection, save rejection/draft recovery, and rendered
   highlights, then include this follow-up in the pending PR and merge after CI.

## Search and visible mutation follow-up

Read-only inspection found one active saved Dag Dugpa record in the affected local
glossary, although the screenshot shows two rows. Search also matches footnotes.
Investigate rejected optimistic edits remaining visible and deletion context when
the collection summary is absent. Restore saved row content after rejected edits,
and use matching editor repository context for deletions as well as saves. Verify
filtered results update without a manual refresh and preserve the search query.

QA terms have a single text field and their own duplicate message; the affected
multi-variant warning and highlight state belong to the glossary term editor.
