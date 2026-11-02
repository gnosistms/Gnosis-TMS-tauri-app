# Term window opened from the chapter editor returns to the editor

Requested by Hans, 2026-11-02.

## Problem

The chapter editor opens the glossary's New/Edit Term window by going to the
glossary page and opening the window on top of it. Two routes do this:

- "Save to glossary" in the editor's glossary-entry window (highlighted text →
  prefilled New Term), in `editor-glossary-entry-flow.js`.
- Double-clicking a glossary-underlined word ("open-editor-glossary-term:"), in
  `actions/navigation-actions.js`.

When the person presses Add Term / Save Term or Cancel, the window closes and
leaves them on the glossary page, which they never chose to visit.

## Change

1. `openGlossaryTermEditor(render, termId, { returnToEditor: true })` marks the
   window's state (`glossaryTermEditor.returnToEditor`). Both editor routes pass
   it; the glossary page's own New Term / edit routes do not.
2. `actions/glossary-actions.js`: after Cancel, or after Add/Save Term has
   started the save and closed the window, a marked window navigates back to
   the chapter (`handleNavigation("translate")`). A save that stays open
   (validation error, duplicate source) does not navigate.
3. The save runs on in the background. If it fails after the person has left
   the glossary page, the failed draft cannot reopen there, so a notice says to
   reopen the glossary to retry (it reopens from the pending write when they
   do). Callers that await the save (research report) report failures
   themselves and get no extra notice.

QA lists have no editor → term-window route, so there is nothing to mirror.

## Tests

`glossary-background-sync.test.js`: the double-click route marks the window
and Cancel / Save return to `translate`; the glossary page's own route stays
on the glossary page.
