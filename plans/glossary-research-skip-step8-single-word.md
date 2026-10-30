# Skip step 8 when there is nothing to choose

## Problem

Step 8 tests candidates separately for each meaning. Its distinct job is choosing
which step 6 candidates are confirmed for the entry. With one active meaning and
one candidate word, there is no choice: step 8 still asks the AI to "select" the
only word, translates and reviews a focused sample, and step 9 then translates
and reviews the same paragraphs again. In the saved single-meaning studies,
step 8 never changed the translation in these cases, and in one it passed only
because its retry showed the translator the previous finding.

## Change

1. On entering step 8, if there is exactly one active meaning and its candidates
   are one word (the same inflection group, or the same text), confirm that
   word, record step 8 as skipped with the reason, clear any pending meaning
   retest flag, and move on to step 9. This follows the existing automatic skip
   of 4.4.1 for non-Samael corpora.
2. Keep step 8 whenever there are several meanings or several candidate words.
   An explicit Redo of step 8 still runs it.
3. Revisiting a skipped step 8 says why it was skipped.
4. Tests: the rule (one meaning and one word; inflection groups; several words;
   several meanings), and a browser test that moving from step 7 skips to step 9
   without step 8 tool calls.
