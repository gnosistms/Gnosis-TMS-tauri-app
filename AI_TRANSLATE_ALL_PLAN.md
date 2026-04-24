# AI Translate All

## Summary
Add an `AI Translate all` toolbar button next to `Unreview All`. It opens a batch translation modal where the user selects visible target languages, excluding the current source language. `Begin translating` fills only empty target fields and never overwrites existing translations.

## Key Changes
- Add the toolbar action and modal using the existing editor toolbar and modal patterns.
- Modal content:
  - Eyebrow: `BATCH TRANSLATE`
  - Title: `AI Translate the entire file`
  - Message exactly as requested.
  - Checkbox list of visible languages except the current source language.
  - Buttons: `Cancel` and `Begin translating`.
- Store modal state in editor chapter state: open/closed, selected language codes, loading/progress, and error message.
- Use the current toolbar Source language as the batch source language.
- Use the primary AI translation action, `translate1`, for this first version.

## Shared Translation Flow
- Refactor the current single-field AI translation implementation so the full translation behavior lives in one context-based helper.
- The existing single-field AI Assistant translate button should build a context from the active row and call this helper.
- `AI Translate all` should build explicit row/language contexts and call the same helper sequentially.
- The shared helper owns:
  - source/target validation
  - AI action/model/key resolution
  - derived glossary preparation
  - AI translation request
  - row update and persistence
  - assistant translation history
  - derived glossary storage
  - provider continuation storage.
- Do not batch by repeatedly changing the active row or active target language.

## Batch Behavior
- Build work for every selected visible target language and row where:
  - source text exists
  - target field is empty
  - source and target languages differ.
- Before each queued translation, re-read the current row and skip the item if the target field is no longer empty.
- Run translations sequentially.
- If derived glossary preparation fills another language field for the same row, keep that value and skip any later queued translation for that field.
- Keep derived glossaries per row exactly as the single-field AI translation flow does.
- Never overwrite existing translations.

## Assistant Continuity
- Preserve the existing rule that translation requests start without a reused `previous_response_id`.
- After each successful translation, save the returned provider continuation on the assistant thread for that row and target language.
- This applies to both single-field AI translation and Translate All because both use the same shared helper.
- Do not reuse provider continuation across different rows during Translate All.

## Failure Handling
- Disable or block `Begin translating` when no target languages are selected.
- If no eligible empty cells exist, show a clear modal-level message and do not start the batch.
- If a translation fails mid-batch, stop the batch, keep already saved translations, and show the error in the modal.
- Close the modal on successful completion and show a notice with the translated count.
- Allow cancel before execution starts; disable cancel while translation is actively running unless existing cancellation support is already available.

## Test Plan
- Unit test modal state: open, cancel, checkbox toggle, empty selection validation.
- Unit test work selection:
  - excludes source language
  - uses only visible target languages
  - skips non-empty targets
  - skips rows without source text.
- Unit test shared translation reuse:
  - single-field AI translation and Translate All both call the shared context-based translation helper.
  - derived glossary behavior remains identical between entry points.
- Unit test batch execution:
  - sequentially translates eligible empty cells
  - does not overwrite existing translations
  - skips cells filled earlier by derived glossary work
  - stores per-row derived glossaries
  - stores returned provider continuation for assistant continuity
  - does not reuse continuation between rows.
- Manual/browser verification:
  - toolbar button appears next to `Unreview All`
  - modal text and buttons match the requested copy
  - selected languages translate only empty fields
  - AI Assistant can continue a conversation started by either single-field translate or Translate All
  - visible row updates preserve smooth scrolling, spacer heights, and active editor focus.

## Assumptions
- "Visible languages" means languages currently shown in the editor, excluding collapsed/hidden languages.
- The toolbar Source language is the source for the batch.
- `translate1` is the batch action for v1.
- Sequential execution is preferred for v1 to reduce rate-limit, persistence, and virtualization risk.
