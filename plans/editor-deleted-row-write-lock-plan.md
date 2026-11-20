# Keep the chapter editable when a deleted row is selected

## Behavior in 0.8.151

In an active chapter with Owner access, expanding **Deleted rows** and clicking a
deleted row's footnote can make every row read-only. Active rows lose **Reviewed**,
and the deleted row loses **Restore**. **Delete** stays visible because it removes
the row locally. Opening another chapter and returning starts a fresh permission
check and clears the session lock.

Two actions reproduced this in an isolated editor fixture using the same action
dispatcher and permission code as the installed 0.8.151 release.

- **Click the footnote.** The screen model gives the deleted row the chapter's
  editability, so its footnote renders as an edit action. The action correctly
  rejects a write to a deleted row, but the permission handler interprets
  “read-only” in the rejection message as a loss of account access and locks
  the chapter. [Row model](../src-ui/app/editor-screen-model.js) · [Footnote renderer](../src-ui/app/editor-row-render.js) · [Permission handler](../src-ui/app/editor-write-permission.js)
- **Select the deleted row and open Mark Unreviewed.** The toolbar action falls
  back to the selected row ID for its permission check. The same rejection locks
  the chapter before the confirmation dialog opens. [Action dispatcher](../src-ui/app/actions/translate-actions.js)

## Implementation

1. **Keep a rejected row edit local to that action.** Carry the existing lifecycle
   reason, such as `softDeleted` or `parentSoftDeleted`, through both the session
   and current-role assertions. Direct and queued writes should report the
   original rejection. Reserve the chapter write lock for an explicit denial of
   chapter-content access, including the existing tagged role error and the native
   message “Your account type cannot edit shared content.” Generic error wording
   alone should never mark other rows' pending saves as failed. [Lifecycle policy](../src-ui/app/resource-write-policy.js) · [Queued writes](../src-ui/app/editor-queued-write.js) · [Native access check](../src-tauri/src/installation_access.rs)
2. **Render deleted row content as read-only.** Derive each row's `canEdit` from
   chapter write access and the row's active lifecycle. Use it for text, footnotes,
   captions, review markers, and sidebar actions that modify the selected row,
   including restoring historical text. Keep the row selectable for reading
   History and Comments. Its **Restore** and local **Delete** buttons continue
   to use their own action-specific permissions.
3. **Check the actual target of each action.** Check chapter-wide commands such as
   `open-editor-unreview-all` and its confirmation against the chapter. Resolve a
   row ID only for commands that act on a row. Keep each bulk command's existing
   checks on the rows it will modify when it runs.
4. **Preserve the click when a text field is open.** A WebKit regression also
   reproduced a missed **Delete** click. Losing focus could redraw the row between
   pressing and releasing the button. **Delete** and **Restore** now move focus
   when the click arrives, allowing the action to run and the open field to save.
   [Editor events](../src-ui/app/translate-editor-dom-events.js)

## Regression tests and acceptance

- **Permission and action tests.** Dispatch the deleted-footnote edit directly to
  cover a click arriving after a row was deleted. Verify that the write is rejected
  before reaching the backend, the session lock stays idle, and a pending save on
  another row keeps its state. Exercise the queued rejection too. Retain the
  Viewer and role-downgrade tests, and cover the native content-access denial as
  a positive case for locking. [Permission tests](../src-ui/app/editor-write-permission.test.js) · [Write-guard tests](../src-ui/app/editor-write-guards.test.js)
- **Browser test.** Use an active row beside a soft-deleted row with a footnote.
  Expand the divider, click the visible footnote, and read its History. With that
  row still selected, open and cancel **Mark Unreviewed**. Edit the neighboring
  row and toggle **Reviewed**. Restore the deleted row and verify its text,
  footnote, position, and edit controls in the same session. Exercise the
  **Deleted rows** filter as a second route to **Restore**. [Editor browser tests](../tests/browser/editor-regression.spec.js)
- Run the focused regressions first, then `npm test`, `npm run build`, and
  `npm run audit:unused`. The fix is complete when a writer can perform the
  full sequence in one visit to the chapter and a genuine loss of write access
  still blocks edits.

## Verification

- The end-to-end editor fixture reproduced the missing **Restore** button before
  the change. With the fix, the same session can read the deleted footnote, open
  **Mark Unreviewed**, edit and review another row, and restore the original row
  in place. The test also checks that restoring the row saves an open draft on
  its neighbor. All ten focused editor regressions passed in both Chromium and
  WebKit. [Browser regressions](../tests/browser/editor-regression.spec.js)
- `npm test` passed all 3,535 frontend tests and 26 workflow tests. The Rust
  content-write permission test passed for Translator, Admin, Owner, and Viewer.
  [Native permission test](../src-tauri/src/installation_access.rs)
- The production frontend build passed. The unused-code audit reported the same
  findings as the pre-change checkout.
