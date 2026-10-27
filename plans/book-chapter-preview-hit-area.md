# Select a chapter without editing its title

Limit the editable input to the rendered title text width. Give the remaining
row space a separate, accessible preview button using the existing chapter
selection action. Keep title-width measurement current after typing and default
title discovery, and retain input/row DOM during scoped updates. Explicitly focus
the preview button on pointer selection so a prior title edit blurs on platforms
that do not normally focus buttons. Verify pointer/keyboard selection, editing,
long titles, and the existing scroll/Enter workflows; update the dev app and PR.

Implemented with a hidden text-width measure beside each title input and an
accessible preview button in the remaining row space. Background padding shares
the chapter selection action; drag and Include/Exclude controls keep their own
behavior. Pointer selection explicitly focuses the preview button and blurs any
previous title edit, while input clicks and keyboard navigation still edit text.

All 17 export browser workflows passed across verification runs, including a new
case for row padding, blank space, text clicks, long titles, keyboard preview,
pressed state, and preserving an earlier edit. The existing 40-chapter scroll,
Enter/IME, inclusion, and reordering checks passed. 3,079 frontend tests and
25 workflow tests passed, along with production build, scoped lint, and whitespace
checks. The dev checkout contains all scoped changes and the layout was inspected.
