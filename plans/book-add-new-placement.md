# Add new at the bottom of the book list

Move the existing section menu out of the language/paper toolbar into a footer
below the scrolling book list. Label the button "+ Add new" and open its menu
upward so all section types remain accessible. Preserve the existing nav scroll
container and scoped Include/Exclude behavior. Verify existing export workflows,
inspect the layout, and mirror the change into the dev app and PR 384.

Implemented as a footer below the unchanged scrolling nav. The menu opens upward
with an opaque surface, and the button tooltip is suppressed while it is open.
All 16 existing export browser workflows and six composer screen tests passed;
desktop/narrow layouts were inspected with a 40-chapter book. Scoped lint,
production build and whitespace checks passed. The dev checkout has the changes.
