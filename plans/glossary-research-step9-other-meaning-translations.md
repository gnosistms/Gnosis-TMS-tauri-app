# Step 9: ask when the AI uses a word approved for another meaning

## Problem

In step 9 the translator sees only the finished entry: the approved words and their
notes, with no definitions and no meaning assignments. The grader then checks each
occurrence against the meaning assigned to it. When the AI uses a word that is
approved only for a different meaning, `assessTrial` fails the occurrence even when
the reviewer found the word right in that sentence. The failure text is then
`STUDIO_UNCONFIRMED_RENDERING`, which the grader writes only when the reviewer gave
no problem.

That failure goes to the coordinated repair. The repair may change only notes and
order, so it writes notes that steer translators away from a word that fits. If it
gives up (`requiresBack`), the needs-form dialog has nothing to offer, because
`studioUnconfirmedRenderings` offers only unapproved words, and the human sees only
"Go back to step 8". Accepting the finding passes that one paragraph and leaves the
entry as it was.

A word from another meaning that the reviewer judges wrong in the sentence is a real
selection error: translators using the glossary would make the same choice. Repairing
the notes is right there, and that stays as it is. So does an unlisted word
(needs-form).

A smaller fault in the same check: the grader looks up the reviewer's candidate by
ID. A word can have several records with the same text (approving a word for one
meaning splits its record), so a correct word can fail because the reviewer named the
record that belongs to another meaning.

## Change

1. Grader (`assessTrial`)
   - A rendering is approved for the occurrence's meaning when any approved record
     for that meaning has the wording the reviewer named, not only the record with
     the reviewer's ID.
   - The grader's own checks (wording approved for the meaning, distinct target
     span, quoted rendering) move into a function, so saved verdicts can be graded
     again without asking the reviewer.
   - Step 9 reviewer prompt only: when the wording is an approved translation listed
     for a different meaning, judge only whether it conveys this occurrence's
     assigned meaning in this sentence. Leave the problem empty if it does; the
     grader records the mismatch itself. Explain if it does not. The rule against
     excusing a wrong meaning because a word is broadly related stays.
2. `studioOtherMeaningRenderings(study, trials)`, next to
   `studioUnconfirmedRenderings`, lists failed step 9 choices where
   - the reviewer had no objection (the problem is `STUDIO_UNCONFIRMED_RENDERING`), and
   - the rendered wording is an approved word of another active meaning but not of
     the assigned one.

   It groups them by word and assigned meaning, with their sentences (`refs`) and the
   word's other meanings. A sentence the human has already ruled on (a
   `translationPreferences` entry rejecting that word there) is left out. This reads
   saved trials as well, so a study paused in step 9 asks the question on Resume.
3. `testCompleteEntry`: after a validation pass, before the repair-limit check and
   before any repair, a non-empty list stops step 9 with
   `{ kind: "other-meaning", keys, offers }` and nothing is applied. The answers
   change how the pass is graded and what the repair should aim at, so a repair round
   run first would be wasted.
4. Answers, one word at a time as in needs-form:
   - **Yes**: approve the word for this meaning as well (`approveStudioCandidate`).
     The entry translators see does not change, so nothing is translated again: the
     saved verdicts of those batches are graded again, now pass, and step 9 goes on.
   - **It has meaning 2**: move these occurrences to that meaning with
     `reviseAssignment`, the path the findings' meaning review already uses. As
     there, step 9 then asks for Retest meanings, which reruns step 8. The remaining
     offers are dropped; the next pass finds any that still apply.
   - **No**: the needs-form choose screen. The word stays approved for its own
     meaning. The chosen word is approved for this meaning if it was not, and a
     `translationPreferences` entry is recorded, so the occurrence counts as a real
     error and the next repair steers that context to the chosen word.

## Dialog

- Title: Use “W” for meaning 1 too?
- Body: In the sentence below, the AI translated *término* as “W”. “W” is approved
  for meaning 2 (its definition), but this sentence has meaning 1 (its definition).
  The reviewer found that “W” fits here. If the sentence really has meaning 2, moving
  it there retests the meanings in step 8.
- The sentence pair with the term and “W” highlighted (`needsFormSentences`).
- Buttons: No, find a different word | It has meaning 2 | Yes, use “W” for meaning 1
  (default).

When the word is approved for more than one other meaning, a select above the buttons
picks which one, and the middle button reads "It has the selected meaning".

## Not changed

- Step 8. There the translator is told each occurrence's meaning, so using another
  meaning's word is a failure to follow that instruction, and step 8's repair can add
  forms.
- Unlisted words (needs-form), and other-meaning words the reviewer judged wrong.
- Rewording a definition. Definitions do not reach the glossary that translators get;
  rewording one is still done in step 4.5.
- Parity: QA lists have no research studio.

## Files

- `app/glossary-research-studio-testing.js`: grader, re-grading,
  `studioOtherMeaningRenderings`, the step 9 stop, the reviewer prompt.
- `app/glossary-research-studio-flow.js`: `confirm`, `move`, `reject`, `ask` and
  `choose` for the new decision kind.
- `screens/glossary-research-studio.js`: the dialog, reusing the needs-form sentence
  pair and choose screen.

## Tests

- `glossary-research-studio-testing.test.js`:
  - A same-text record of the assigned meaning passes.
  - The helper lists only reviewer-accepted words of another meaning. It skips words
    also approved for the assigned meaning, failures with a reviewer reason, and
    sentences already ruled on.
  - Step 9 stops with the decision before any repair call.
  - Yes grades the saved trials again, and step 9 completes with no translate or
    assess call.
  - No records the preference; the next pass repairs with it in `humanPreferences`.
  - A failure with a reviewer reason still goes to repair.
- `src-ui/screens/glossary-research-studio.test.js`: dialog text, buttons and the
  meaning select.
- `tests/browser/glossary-research-studio.spec.js`: the dialog, Yes, It has meaning 2,
  and No through the choose screen.
