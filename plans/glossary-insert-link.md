# Insert links in the term editor

## Design preview

1. In New Term and Edit Term, place the main editor’s chain icon immediately after the ruby button in each language’s controls. Use the same 28 px circular button as the adjacent controls. Either button targets the selection in the last active editable textarea, including notes and the footnote.
2. Open the main editor’s link dialog above the term draft. Preserve its empty-selection prompt, URL validation, existing-link replacement, keyboard actions and selection restoration.
3. Exercise the prototype in a browser and capture the control and open dialog for review.

The standalone preview uses sample data. Chromium and WebKit verified all five field types, both prompts, URL replacement, focus restoration, undo and redo, and a narrow window.

## Application integration

- Share the button renderer, modal renderer, validator and markup edit with the main editor. Give the term editor its own selection and draft adapter so opening it does not require a chapter.
- Support source and target variants, variant notes, global notes and the footnote. Place the same circular button beside the QA term editor’s ruby control. Preserve the visible term text for matching and use the existing sanitized inline-link renderer in display surfaces. Check literal and regular-expression QA matching.
- Verify New Term and Edit Term, source and target selection, cancellation, editing an existing URL, undo and redo, and save and reopen. Check that Enter and Escape operate on the topmost dialog.

## Verification

- Chromium and WebKit exercised the shared dialog in both term editors, including a second target variant, all five glossary fields, a background redraw with the URL dialog open, replacing and undoing links, and saving and reopening. The glossary hover card opened a saved link through the external URL handler.
- The native storage tests cover linked and unlinked duplicate detection and literal and regular-expression QA matching. The main editor link tests cover row text, image captions and footnotes.
