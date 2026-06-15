# Editor Insert Link Focusout Fix

## Bug

When the insert-link modal focuses its URL input, focus leaves the active editor
textarea and the editor focusout cleanup collapses that textarea. Submitting the
modal then cannot find the original field, so it closes without inserting the link.

## Plan

1. Treat focus inside the active insert-link URL modal as part of the originating
   editor row/language interaction.
2. Keep the focusout cleanup behavior unchanged for unrelated modals, rows, and
   language clusters.
3. Add a focused regression test for the focus guard so the link modal cannot
   unmount its source textarea before submit.
4. Run the targeted frontend test file, then the full Node test suite if the
   targeted check passes.
