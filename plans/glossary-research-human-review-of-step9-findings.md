# Human review of step 9 findings

## Problem

When a step 9 batch still fails after its repair rounds, the study pauses with
"Selection needs review" and offers only Stop or Continue. The human often sees
that the reviewer was wrong, that the paragraph is a poor test, or that the entry
needs a change, but the UI offers no way to act on any of these. Continuing only
spends more AI repair rounds.

## Change

1. Rename the selection-decision buttons to "Review the errors yourself" and
   "Continue 3 more rounds with AI". Reviewing hides the question, pauses, and
   opens the first stuck batch's findings in the step report. Step 8 progress
   decisions keep Stop/Continue (they are not three-round extensions).
2. Each current step 9 finding banner (work list review lists and the report's
   "Findings to review") gets three buttons below the reviewer's text:
   - **Mark this translation as acceptable.** Saves the exact translated paragraph
     text as accepted for that occurrence (`study.acceptedTranslations`). The
     choice then counts as passed (`override: "accepted"`, `reviewerPassed: false`).
     A different translation of the same paragraph is reviewed normally again.
   - **Ignore this error.** Adds the paragraph to `study.ignoredTestParagraphIds`.
     Its occurrences no longer decide pass/fail (`override: "ignored"`) and are
     not counted as usage evidence. The translation is not called correct. The
     paragraph stays in its batch so other batches keep their saved results.
   - **Edit glossary entry.** Opens the standard glossary term modal on the
     entry under test (preferred translations, their notes, global note,
     footnote). Saving writes to the study, not the glossary: renamed, added,
     removed or reordered translations update the study candidates; a new
     translation joins the meaning of the finding it was opened from. Source
     variants come from step 2a and are read-only here. An edit clears the
     stuck selection question; Resume retests with the edited entry.
   Accepted and ignored findings show their state and an Undo button instead.
   Buttons appear only on findings from the current saved trial while research
   is not running; older rounds stay as history.
3. Overrides are applied wherever a trial is assessed (steps 8 and 9) and when
   the best earlier entry is restored, so repair loops never try to "fix" an
   accepted or ignored occurrence. If accepting or ignoring resolves every batch
   in the stuck question, the question is cleared and step 9 resumes; with all
   batches current this completes without new AI calls.
4. Tests: override application and undo, usage counting, entry-edit mapping
   (reorder, notes, rename, add, remove, meaning left without translation),
   decision buttons, banner buttons and states. Verify in the studio preview.
