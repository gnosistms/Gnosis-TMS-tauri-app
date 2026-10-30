# Research waits only when the translator has a decision to make

## Problem

After a research step finished, the studio waited for "Save and continue" even
when the step only reported findings (dictionary, corpus meanings, word parts,
source searches, source summary, compounds, spelling). The translator had
nothing to decide there.

## Change

1. Steps that only report findings continue on their own: 3, 4.1, 4.2, 4.3,
   4.4.1, 4.4.2, 4.4.3 (stored as 4.4.4), 5 and 7. Their results stay in the
   outline (✓) for reading later. `studioStepNeedsReview` still stops for a
   pending question, an error, unfinished or missing results, failed
   retrievals, a stale dictionary review, or no research paragraphs in step 3.
2. Steps with choices still wait: scope (1), forms (2a), existing entries
   (2b, when there are any), meaning review (4.5), meaning assignment (4.6),
   split entries (4.7, when there are proposals), candidates (6), the tests
   (8, 9, under their existing rules), usage (10a), collisions (10b), save (11)
   and the split-entry queue (12).
3. Meaning review (4.5) no longer repeats the source-summary skip rule; it
   stays on 4.4.1 and 4.4.3.
4. The unmatched-occurrence dialog has one "Meaning" dropdown: the active
   meanings plus "Enter new meaning below". The new-meaning box shows only for
   that option. It starts on the AI's suggestion (the existing meaning it
   repeated, otherwise a new meaning prefilled with its definition). One
   "Assign meaning" button assigns the choice; an empty new meaning is refused.

## Tests

- Review predicate: findings no longer stop; missing, failed and stale still do.
- Screen: rule note hidden on 4.5; dialog dropdown, box and single button.
- Browser: affected end-to-end flows continue past finding steps; the dialog
  assigns an existing or typed meaning.
