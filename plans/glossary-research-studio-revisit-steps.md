# Revisit research steps safely

## Request
Allow researchers to click earlier steps without running work or changing completion
state. Before an edit, rerun, skip, or other research mutation invalidates later
results, show “Redo this step?” with the requested message and Cancel / Continue.
Cancel preserves all research; Continue clears dependent active outputs and marks
those steps undone.

## Implementation
1. Use the workflow's existing downstream dependency contract for invalidation;
   clear dependent step records and derived state, preserving earlier and current
   inputs, saved glossary entries, raw evidence receipts, and unrelated studies.
2. Add read-only outline navigation and make Back use the same path. Revisiting or
   advancing through unchanged saved work must not run tools, recommender calls,
   retention initialization, or save new approvals.
3. Gate edits and mutating actions before applying them. Keep the pending action
   outside durable study state; use the shared modal keyboard/accessibility system.
   Restore original input values on Cancel; apply a queued edit once on Continue.
4. Test read-only navigation, unchanged forward travel, cancel/continue, reruns,
   skipped steps, cold evidence hydration, and dependent-state clearing. Run focused
   unit and browser tests, lint, and the frontend build.

This is specific to the glossary research workflow; QA lists have no research
studio or step model to update.

## Implemented
- Outline buttons and Back hydrate saved reports without tools or approval writes.
  Forward browsing preserves completed, skipped, and stale checkpoint statuses.
- The first real edit or explicit rerun warns with the requested shared modal.
  Cancel discards the pending edit; Continue clears active downstream outputs,
  tests, repair rounds, retention, collision choices, drafts, and pending decisions.
- Cleared steps display “undone” and cannot be visited as finished work. Saving
  the revised checkpoint preserves that state until the workflow reruns them.
- A saved review cursor reopens without automatic recommendations. Saved glossary
  entries and separate studies remain intact.

## Verification
- 189 focused studio unit tests passed.
- All 57 pre-existing/current studio browser scenarios passed; the additional
  reopening scenario and final navigation/edit regression checks passed separately.
- ESLint, frontend production build, and whitespace checks passed.
- Browser fixtures stub provider calls: no paid AI calls or real study mutations.
- Visually inspected the updated outline and edited-step/undone-state screenshot.
