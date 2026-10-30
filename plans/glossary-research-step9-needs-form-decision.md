# Step 9: stop with a decision when a form needs confirming

## Problem

The antítesis study stopped in step 9. Two dialectic occurrences of meaning 2
were translated "phản đề", which is a step 6 candidate for that meaning but was
never confirmed, because step 8's focused sample had no dialectic example.
Step 9's coordinated repair may change only notes and order, so it answered
`requiresBack`. `applySelectionRepair` turned that into a thrown error:

- The researcher got an error in the target language and no way forward.
- The work list kept "Coordinated repair", its repair group and batch 1's
  translation row as running, and an older "repair round 1" as paused.
- Batch rows from an earlier, larger sample ("of 98") stayed as waiting after the
  sample shrank to 73 paragraphs.

## Change

1. When step 9's repair answers `requiresBack`, nothing from the repair is
   applied and step 9 stops with a decision (`kind: "needs-form"`):
   - It lists each unconfirmed candidate of the failed occurrence's meaning that
     the failed rendering uses, with the meaning and how many failed
     occurrences used it, plus the repair's reason (now asked for in English).
   - "Confirm and retest" confirms those candidates and re-runs step 9, as
     editing the entry in step 9 already does.
   - "Go back to step 8" clears the decision and opens step 8.
   - With nothing to offer, only "Go back to step 8" is shown.
2. When a step stops with an error, rows still running or waiting under the
   failed run are marked failed or left waiting, so nothing spins.
3. Step 9 plans its batch rows from the current sample and drops batch rows
   that no longer exist.

## Tests

- Repair `requiresBack` sets the decision with the offer and applies nothing.
- Confirming re-runs step 9 with the candidate confirmed.
- Error marks running rows as failed.
- Stale batch rows are dropped when the sample shrinks.
