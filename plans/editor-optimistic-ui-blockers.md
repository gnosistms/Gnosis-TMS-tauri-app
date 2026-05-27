# Editor Optimistic UI Blocker Inventory

## Summary
The editor still serializes several UI operations around row save and commit state. Row text editing is partly optimistic, but adjacent editor actions are blocked by `saveStatus`, `markerSaveState`, `textStyleSaveState`, comment save state, or dirty-row flush failures.

The immediate issue observed with the `Please check` button comes from two locks:
- The marker button is rendered disabled while its own marker save is in flight.
- The marker toggle action also refuses to run while row text, markers, style, comments, or other dirty rows are pending.

## Current Blocking Points

1. Review marker buttons: `Reviewed` and `Please check`
   - Buttons are disabled during marker save.
   - The action blocks if row text is saving, marker save is active, row style is saving, comments are saving, or other dirty rows cannot flush.
   - Files:
     - `src-ui/app/editor-row-render.js`
     - `src-ui/app/editor-persistence-flow.js`

2. Text style buttons
   - Style buttons are disabled while style save is active.
   - The style action refuses to run while marker, style, or comment writes are pending, and waits for row text to become idle.
   - Files:
     - `src-ui/app/editor-row-render.js`
     - `src-ui/app/editor-persistence-flow.js`

3. Comments
   - Saving or deleting comments is blocked if row text, markers, or style are saving.
   - File:
     - `src-ui/app/editor-comments-flow.js`

4. Image updates
   - Image add, remove, and update operations are blocked while row text, row style, or review markers are saving.
   - File:
     - `src-ui/app/editor-image-flow.js`

5. Restore from history
   - Restore is blocked until active row text, marker, and style saves are idle.
   - File:
     - `src-ui/app/editor-history-flow.js`

6. Batch replace undo
   - Undo is blocked if any row has non-idle save status, marker save, or style save.
   - File:
     - `src-ui/app/editor-history-flow.js`

7. Row delete
   - Soft-delete row is blocked while that row text, marker, or style save is pending.
   - File:
     - `src-ui/app/editor-row-structure-flow.js`

8. Search/replace row selection
   - Row selection checkboxes are disabled while batch replace is saving.
   - Files:
     - `src-ui/app/editor-screen-model.js`
     - `src-ui/app/editor-row-render.js`

9. Replace selected rows
   - Replace selected rows is blocked if any selected row text, marker, or style save is pending.
   - File:
     - `src-ui/app/editor-search-flow.js`

10. Unreview all and clear translations
    - Both actions flush dirty rows first, then abort if any editor writes remain pending.
    - File:
      - `src-ui/app/editor-persistence-flow.js`

11. AI Review All
    - AI Review All flushes dirty rows first, then refuses to run if pending writes remain.
    - File:
      - `src-ui/app/editor-ai-review-all-flow.js`

12. Target language manager
    - Changing file languages is blocked until pending editor saves resolve.
    - File:
      - `src-ui/app/editor-target-language-manager-flow.js`

13. Opening a different file or leaving the editor
    - Navigation is blocked when dirty rows cannot flush.
    - Files:
      - `src-ui/app/editor-chapter-load-flow.js`
      - `src-ui/app/editor-navigation-guards.js`

14. Background sync / refresh
    - Sync is skipped while row text, marker, style, or comments are saving.
    - This is less visible as a disabled UI control, but refresh behavior is still gated by pending saves.
    - File:
      - `src-ui/app/editor-background-sync.js`

## Main Takeaway
The editor currently treats many row-adjacent actions as mutually exclusive writes. To make the UI feel fully optimistic, these paths need to be moved toward queued/coalesced per-row intents, optimistic local state, and failure rollback or conflict surfacing instead of UI disabling.

