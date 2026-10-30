# Re-check unmatched occurrences after each "Choose a meaning" answer

## Problem
Step 4.6 (Assign meanings) classifies every sampled paragraph in one AI call
before the translator answers anything. Each occurrence the AI cannot place is
stored with no meaning, and the "Choose a meaning" dialog asks about them one
by one. An answer sets only that one occurrence: the remaining unmatched
occurrences are never classified again, neither with a meaning the translator
typed nor with their picks as examples. So the dialog keeps asking about uses
it has already been told about.

The dialog's pre-selection has a second gap. The AI that suggests a meaning
returns only a definition, and the dialog picks an existing meaning only when
that definition repeats it word for word. A reworded suggestion selects "Enter
new meaning below" and invites a near-duplicate meaning.

## Changes
1. `glossary-research-studio-flow.js`: an answer in the dialog marks its
   assignment `humanChoice: true`.
2. `glossary-research-studio-stages.js` (`assignMeanings`):
   - Every classification, plus the dialog's suggestion, receives the human
     choices as `reviewedExamples` (paragraph text, occurrence offsets,
     meaning ID). The first pass has none, so its request is unchanged.
   - Before the next dialog opens, if the meanings or human choices changed
     since the last re-check, the paragraphs that still have unmatched
     occurrences are classified again. Only unmatched occurrences take the
     result. `s.unmatchedRecheck` records what the last re-check saw, and the
     first pass clears it.
   - The suggestion returns `meaningId` (an existing meaning's ID, or null)
     and receives the compact meaning list. An unknown ID becomes null.
3. `unmatchedMeaningChoice` pre-selects `recommendation.meaningId` first and
   keeps the word-for-word match for decisions saved before this change.

## Tests
- Stages: an answer with a new meaning sends the remaining unmatched paragraph
  back with that meaning and the example. A match fills it without a second
  dialog, and occurrences that already had a meaning are not overwritten. A
  resume without a new answer does not ask again.
- Stages: the suggestion's unknown `meaningId` becomes null.
- Screen: `recommendation.meaningId` pre-selects that meaning even when the
  definition is reworded.
