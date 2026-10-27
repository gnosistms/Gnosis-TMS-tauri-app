# Keep the Add new footer stationary

1. Reproduce the book modal's outer scroll range at short/resized window sizes.
   The sidebar footer already sits outside the chapter nav; investigate parent
   sizing and scroll chaining instead of saving/restoring scroll positions.
2. Bound the modal and composer to the available viewport, let header/toolbars
   keep their measured heights, and give scrolling only to the list and preview.
   Keep the Add new footer outside those panes and preserve its upward menu.
3. Verify wheel scrolling at both ends of each pane, resize behavior and the
   existing inclusion/title-editing workflows; mirror into dev and update PR 384.

Completed: reproduced a 9px outer scroll range before the fix. The modal now has a
bounded flex layout: headers/toolbars retain their measured heights, the composer
shrinks to the available space, and the list/preview own scrolling with chaining
contained. The non-scrolling Add new footer retains its bottom padding and upward
menu. Narrow layouts also keep the list and preview in independently scrolling
panes.

Verified four viewports (1280×720, 1003×560, 1600×1000, 720×900), wheel scrolling
past both edges of each pane, footer/button geometry and menu accessibility.
Desktop and narrow screenshots reviewed. All 20 export workflows pass across
verification runs on fresh servers; the footer check also passes against the
running dev frontend. Updated an old browser assertion to match the previously
requested Include tooltip and its accessible unavailable-language description.
3,084 frontend tests, 25 workflow tests, JS lint, production build and whitespace
checks pass. Final feature/test sources are mirrored into the dev checkout.
