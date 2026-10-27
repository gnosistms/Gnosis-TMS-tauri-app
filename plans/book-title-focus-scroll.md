# Keep chapter-title focus and list scroll stable

Selecting a chapter title currently redraws the entire export modal, then redraws
again while loading its preview. Replacing the scrollable chapter list loses its
scroll position even though focus is restored to the chosen title.

1. Reproduce with a long chapter list and a title-to-next-title click after editing.
2. Add a scoped book-preview render that retains the list, its inputs, and its
   scroll container. Apply selection/default-title updates in place. Use it for
   chapter selection and asynchronous preview/title loading.
3. Verify focus, caret, list identity and scroll during clicks, Tab navigation,
   and cached/asynchronous previews; retain existing export coverage.
4. Apply the same fix to PR 384's integration checkout and keep the running dev
   app updated for testing.

## Completed

Chapter selection and asynchronous preview/default-title reads now use a scoped
render. It updates selected-row classes and discovered defaults in place, then
patches only the chapter preview or contents entries. The chapter list and title
inputs remain connected; focus and scroll do not need to be reconstructed after
a modal redraw. Typed values are only assigned when they actually differ.

Validation:

- Reproduced the original long-list jump before the fix.
- New 40-chapter browser regression verifies retained list/input identity,
  unchanged scroll, focus transfer after editing, Tab/Shift+Tab, and delayed
  preview completion. All 10 export browser workflows pass on the running dev
  server.
- Full frontend suites pass in both checkouts: 3,126 tests in the development
  checkout, 3,072 in the PR checkout, plus 25 workflow tests each.
- ESLint, production build, and whitespace checks pass. The unused-code audit
  remains at its baseline of 41 unused files and 16 exports.
- The fix is applied to the running dev checkout and the PR 384 branch.
