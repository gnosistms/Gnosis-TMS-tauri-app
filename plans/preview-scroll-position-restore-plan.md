# Preview Scroll Position Restore Plan

## Goal

Remember preview-mode scroll position per chapter and restore it when returning
to preview mode.

## Cases

- Switching preview to translate mode, especially double-clicking a preview
  sentence to edit it.
- Leaving the editor for Projects, Glossary, or QA list screens.
- Returning to the same chapter and entering preview mode again.

## Approach

Use a dedicated chapter-scoped preview-scroll preference. Translate mode
continues to use row anchors plus optional `scrollTop`; preview mode stores a
scroll-only value keyed by chapter id so double-clicking from preview into
translate can keep both the translate anchor and the preview scroll position.
Restore preview scroll only when the editor is on the translate screen, the
chapter is ready, and the current mode is preview.
