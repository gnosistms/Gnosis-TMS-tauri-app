# Test with the rest of the glossary in steps 8 and 9

## Problem

Steps 8 and 9 translate with a glossary built from the entry under research and
the study's own split-off entries (`temporaryGlossaryTerms`). Saved glossary
entries are never sent. The step that picks which occurrences to test
(`studyAssignments`) knows the same entries only.

After "batallar de las antítesis" was saved as its own entry, the antítesis study
still tested every "antítesis" inside that phrase as plain "antítesis". The
translator never saw the phrase's entry, and in production the antítesis entry
never applies there anyway, because the longer entry wins.

## Change

1. Before steps 8 and 9 run (and the final retest in 10b), collect the saved
   glossary entries that match the study's paragraphs into `study.glossaryContext`.
   Leave out:
   - the entry this study replaces (`savedTermId`),
   - entries step 2b merges into it (`relatedEntries`),
   - entries sharing a source form with the study or its split-entry queue, since
     the study supersedes them and step 10b decides collisions.
   Store only the fields the glossary model reads, so unrelated metadata does
   not change trial signatures.
2. The trial glossary (`trialGlossary`) includes these entries, so the
   translator gets the same hints as in production and the longest-match rule
   gives a longer entry priority.
3. `studyAssignments` includes them too, so an occurrence that a longer saved
   entry covers is not tested. Other occurrences in the same paragraph still are.
4. Step 8 and step 9 signatures include `glossaryContext` when it is not empty,
   so adding or editing a matching entry re-tests, while studies with no matching
   entries keep their saved trials.

## Tests

- Collection: exclusions above; only entries that match a paragraph; stored
  fields.
- Assignments: an occurrence inside a longer saved entry is dropped; one outside
  it stays.
- Translation: the hints include the longer entry.
- Signatures: change when a matching entry changes.
