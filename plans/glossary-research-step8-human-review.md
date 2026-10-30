# Step 8: let the human accept or ignore findings

## Problem

Step 8 has no way out when its tests cannot all pass. The progress card offers
Stop or Continue (5 more AI rounds), "Save and continue" stays blocked until
every meaning passes, and "Mark this translation as acceptable" / "Ignore this
error" exist only in step 9. The progress report is also written in the target
language and names internal IDs (c7, m2, o0, paragraph IDs).

## Change

1. Step 8 findings get "Mark this translation as acceptable" and "Ignore this
   error", using the same overrides as step 9 (`acceptedTranslations`,
   `ignoredTestParagraphIds`), which the shared assessment already applies.
   "Edit glossary entry" stays step 9 only, because it edits the complete entry.
   - A finding is current when its meaning trial matches the meaning's current
     signature and repair round.
   - When the last failure of the meaning in a progress question is accepted or
     ignored, the question closes. When every meaning then passes, step 8
     completes from the current results without new translations.
2. The step 8 progress card says "Review the errors yourself" (pauses and opens
   that meaning's findings) and "Continue 5 more rounds with AI".
3. The progress report is asked for in English, naming meanings by number and
   candidates by their text, never internal IDs.

## Tests

- Accepting and ignoring step 8 findings passes the meaning trial; a stale
  trial offers no buttons.
- The progress question closes when its meaning passes.
- The card's labels; the report prompt asks for English without IDs.
