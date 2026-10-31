# Glossary Research Studio: suggest missing meanings in step 6

## Problem

Step 6 asks the AI for translation candidates and ties each candidate to the
meanings it translates. The prompt also says never to drop a translation carried
over from an existing glossary entry. When a carried translation fits none of
the meanings, the AI returns it with no meanings, and step 6 rejects the whole
proposal with "A candidate has missing or unknown meaning applicability." Retry
asks the AI again, which usually gives the same answer, so the researcher is
stuck.

A translation that fits no meaning can be a sign that the research missed a
meaning. It can also be a loose or mistaken translation in the old entry.

## Behaviour

1. Meaning IDs that are not active meanings are ignored. A candidate left with
   no meaning, and not already declined by the researcher, is an *orphan*.
   Candidates with no text are ignored.
2. If there are orphans, step 6 does not fail. It asks the AI which additional
   meanings of the researched term the orphan translations express. The AI
   combines translations that express one meaning, may reject a translation
   that fits no genuine meaning (with a reason), and gives up to six
   source-language context clues per suggested meaning.
3. For each suggested meaning the studio looks for up to 15 matching search
   results:
   - first in the research sample (`s.passages`), in batches of 50;
   - then, while a meaning still has fewer than 15, in up to 200 further corpus
     paragraphs, loaded the same way as the 4.6 missing-meaning search and
     ranked by the clues.
   Each batch asks the AI which occurrences have a suggested meaning rather than
   an existing one. Invalid matches are ignored rather than failing the step.
4. A dialog, "Add a missing meaning?", lists the orphan translations, each
   suggested meaning with an editable definition, an "Add this meaning"
   checkbox (ticked when matches were found), the translations that suggested
   it, and its matching paragraphs with the occurrence highlighted. Rejected
   translations are listed with the AI's reason.
5. **Add selected meanings** adds the ticked meanings to the meaning list,
   adds matching paragraphs from outside the sample to the research paragraphs
   (as `recovered`, like the 4.6 search does), re-approves 4.5 with the new list,
   clears 4.6 onward and runs 4.6 again. Steps 4.7 to 6 then run again with the
   new meanings. Translations whose meaning was not added are remembered as
   declined.
6. **Continue without adding** remembers all orphan translations as declined and
   reruns step 6, which reuses the cached AI proposal, leaves the declined
   translations out (including carried translations, which would otherwise be
   added back under every meaning) and completes normally.

The declined list (`s.missingMeaningReview`) is reset when step 6's results are
cleared by redoing an earlier step, except on the add path above, which sets it
after clearing.

## Code

- `glossary-research-studio-stages.js`: orphan detection in case "6";
  `suggestMissingMeanings` (suggestion call, sample and population search,
  pending decision).
- `glossary-research-studio-flow.js`: resolve the `missing-meaning` decision;
  `runCurrentStage` never reuses a stored `{ pending: true }` value, so a
  resolved decision reruns the stage.
- `glossary-research-studio-workflow.js`: reset `missingMeaningReview` with
  step 6.
- `screens/glossary-research-studio.js`: the dialog.

## Tests

- Stage unit tests: an orphan produces suggestions and matches capped at 15,
  searching the population only when the sample has too few; unknown IDs are
  ignored; declined translations, including carried ones, are left out.
- Screen unit test: the dialog lists meanings, matches and rejected translations.
- Browser test: Add selected meanings adds the meaning and returns to 4.6;
  Continue without adding completes step 6 without the declined translation.
