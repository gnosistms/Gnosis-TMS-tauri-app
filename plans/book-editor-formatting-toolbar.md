# Book editor formatting toolbar

Move the italic, copyright-symbol, and separator controls from the copyright and
dedication page artwork into a compact toolbar attached to the editor pane.

1. Render formatting controls outside the book-page article, above its scrolling
   preview. Preserve the existing action handlers and editor selection behavior.
2. Style the toolbar as editor chrome with compact buttons and a bottom border;
   keep it visible while the page scrolls, including the narrow-screen layout.
3. Verify the existing composer tests and exercise formatting and toolbar placement
   in a browser. Inspect the resulting editor view.

Status: complete.

Validation: three existing composer unit tests, changed-module ESLint, and the
existing book-composer browser workflow passed. A separate Chrome check verified
both editors keep the toolbar outside the page and fixed while the page scrolls,
and all three actions still modify the editor correctly. Visually inspected
desktop copyright and narrow-screen dedication screenshots.

Follow-up: give all three controls a visible button surface and border, and replace
font-dependent italic/copyright glyphs with consistent outlined SVG icons. Preserve
the standard copyright character inserted into the editor. Recheck appearance and
the existing formatting actions in Chrome.

Follow-up complete: visible warm button surfaces, borders, hover/pressed states,
and matching outlined italic/copyright icons. All three unit tests and ESLint pass;
Chrome checks confirm formatting still works in both editors. Inspected the updated
desktop screenshot.
