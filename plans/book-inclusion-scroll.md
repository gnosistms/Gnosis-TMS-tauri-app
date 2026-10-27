# Include/exclude without scroll jumps

1. Reuse the scoped book-preview render for inclusion changes. Keep the dialog,
   scrolling list, preview panes, and unaffected row inputs mounted.
2. Render stable included/excluded list groups and patch only the moved row,
   counts, empty-state visibility, and Next availability. Preserve normal browser
   anchoring; do not capture and restore scroll around a modal rebuild. If the
   moved row held focus, focus its surviving neighbor with preventScroll.
3. Cover repeated Exclude and Include in long lists, preview DOM/scroll retention,
   chapter numbering/contents, empty groups and Next availability. Mirror changes
   into the dev checkout, verify workflows, and update PR 384.

## Implemented and verified

Inclusion changes use the scoped preview renderer. Included/excluded groups stay
mounted; only the toggled row is replaced and moved, with unaffected inputs and
all scrolling containers retained. Counts, hidden empty states, Next, contents,
and chapter numbering update in place. A surviving neighbor receives focus with
preventScroll; a focused title input on the moved row is not refocused in its
new distant location. No scroll snapshot/restore is used.

All 16 export browser tests passed, including a 40-chapter list with repeated
mouse/keyboard toggles, stable preview/editor/input DOM, unchanged Exclude scroll,
native anchoring on Include, focus handling, empty groups, numbering and contents.
The two new focused cases also passed against the running dev server.
3,079 frontend tests and 25 workflow tests passed; production build, scoped lint,
and whitespace checks passed. Unused-code baseline remains 41 files/16 exports.
Scoped files are byte-identical in the running dev checkout, and Vite reloaded
them without disturbing its other local work.
