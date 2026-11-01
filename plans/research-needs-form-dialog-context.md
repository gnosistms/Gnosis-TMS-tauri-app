# Step 9 "translation needs confirming": ask one plain question

## Problem

When a step 9 repair needs a translation that is not approved, the dialog said
"“ma” for meaning 3: used in 1 failed occurrence but not confirmed." It did not show
the sentence, did not say what the buttons do, and "Confirm" approved the candidate
for every meaning it was attached to, not only the tested one. The only other answer
was "Go back to step 8".

The stop itself was partly caused by the grader's mechanical failure text "No
confirmed candidate for this meaning", used when the wording is not approved *for the
assigned meaning* even when that meaning has an approved translation. The repair AI
read it literally. It now says "The wording used is not a confirmed translation for
this meaning" (saved trials with the old text are still recognised).

## Dialog

One unapproved word at a time (offers are asked about in order).

Question screen:

- Title: Add “ma” to the approved translations?
- Body: In the sentence below, the AI translated *fantasma* as “ma”. “ma” isn’t an
  approved translation yet.
- Source text with the researched term highlighted; target text with “ma” highlighted.
- Buttons: No, find a different word | Yes, add “ma”

Yes approves “ma” only for the meaning of that sentence. An unapproved candidate
attached to other meanings is split: the approved copy carries this meaning, the
original keeps the others, still unapproved.

No opens a second screen:

- "You said that “ma” is not a good translation of *fantasma* in the sentence below."
- The same sentence pair.
- "Please select the translation you prefer": approved translations for this meaning
  first (the first one preselected), then other approved translations, then
  unapproved candidates "(not yet approved)", then "Add another translation…", which
  shows a text field.
- Buttons: Back | Continue

Continue removes this meaning from “ma”, approves the chosen word for this meaning
(same per-meaning rule as Yes; a typed word becomes a new approved candidate, or
reuses a candidate with the same text), and records the preference
(`study.translationPreferences`). Step 9 repairs receive these preferences as
`humanPreferences`, so usage notes steer those contexts to the chosen word.

When no unapproved candidate explains the failure, the dialog keeps the "Go back to
step 8" fallback.

## Files

- `app/glossary-research-studio-testing.js`: offer/sentence helper, choices list,
  per-meaning approve/reject, repair input.
- `app/glossary-research-studio-flow.js`: `reject`, `ask`, `confirm`, `choose` actions.
- `screens/glossary-research-studio.js`: the two screens; target-side highlights.
- Unit tests and the browser test for this dialog.
