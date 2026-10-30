# Consistent save and send shortcuts

## Goal

Cmd+S (macOS) / Ctrl+S (other platforms) is the one save shortcut. The
AI Assistant composer behaves like Codex and Claude Code: Return sends,
Shift+Return breaks a line.

## Decisions (Hans, 2026-10-30)

- The row editor moved to Cmd/Ctrl+S in `in-row-paragraph-breaks-plan.md`, but
  three places kept Shift+Return:
  - the image URL field (and the language header there already reads
    "Command + S to save", while Cmd+S fell through to the native
    "Sync with Server" menu item);
  - the glossary term editor's text fields;
  - the AI Assistant composer, as its send key.
- The image URL field and the glossary term editor now save on Cmd/Ctrl+S
  only. The QA term editor gains the same shortcut for parity; it had none.
- The AI Assistant composer sends on Return; Shift+Return inserts a newline.
  IME composition is already excluded before the handler runs.

## Steps

1. Share one `isSaveShortcut(event)` predicate in
   `events/keyboard-shortcuts.js`; the row editor, both term editors and the
   image URL field use it.
2. Switch the composer handler in `translate-editor-dom-events.js` and its hint.
3. Update the source and browser tests.

## Validation

- `npm test`.
- Browser tests for the image URL field, the composer and the term editors.
