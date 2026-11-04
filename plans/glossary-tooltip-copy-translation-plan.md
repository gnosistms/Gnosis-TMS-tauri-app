# Copy a glossary translation from the source tooltip

## Goal

Long glossary phrases are hard to remember. When the tooltip on a
source-language glossary term shows exactly one translation, it says
"Command + C to copy" (macOS) or "Ctrl + C to copy" (Windows, Linux), and that
shortcut copies the translation to the clipboard.

## Rules

- Only source-term tooltips (`kind: "source"`), including derived-glossary
  source terms. Target-term tooltips keep their footnote hint.
- Exactly one translation: one target variant with text, and no
  "No translation" option (which counts as a second choice).
- The copied text is the variant exactly as the glossary stores it, so a ruby
  annotation stays in the inline markup that the glossary check matches, and a
  "…" gap marker stays for the translator to fill.
- A text selection wins: if the focused field or the page has a non-collapsed
  selection, Cmd/Ctrl+C keeps its native copy.
- Copying is not a write, so read-only members can use it too.
- A highlight redraw can replace the hovered mark while the tooltip stays
  open, and no pointer event reaches the new mark. The shortcut (and the
  footnote shortcut) then take over the mark now under the pointer, so they
  still do what the tooltip says; with no mark there, the tooltip closes.
  Seen as a CI failure on 2026-11-04 (Ubuntu): the hint showed, Ctrl+C did
  nothing.

## Implementation

1. `events/glossary-tooltip.js`: `glossaryTranslationCopyTextForMark(mark)` and
   `activeGlossaryTranslationCopyText()`; render the hint in the card footer,
   right-aligned like the footnote hint.
2. `events/keyboard-shortcuts.js`: `shouldCopyHoveredGlossaryTranslation`,
   dispatching `copy-hovered-glossary-translation`.
3. `actions/translate-actions.js`: write the text with
   `navigator.clipboard.writeText` and show a notice badge.
4. `styles/base.css`: share the right-aligned hint style.

## Verification

- Unit tests for eligibility (one variant, several, no-translation, target
  terms) and the shortcut guard (modifiers per platform, selection).
- Browser test: hover a source mark, see the hint, press the shortcut, check
  the clipboard text; no hint when the term has two translations. The copy and
  footnote shortcut tests redraw the row's marks on the key press, before the
  app sees it, so they check the redrawn case every run.
