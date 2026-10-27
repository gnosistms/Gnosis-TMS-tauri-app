# Chapter settings gear menu

1. Replace the selected chapter's Numbered checkbox with a gear beside each
   chapter's include/exclude control. Reuse circular action-button, tooltip and
   context-menu CSS; give the sidebar enough minimum width for both buttons.
2. Open a bounded menu inside the export dialog, outside the clipped list. Its
   Numbered check action uses the existing numbering/persistence flow without
   selecting or editing a different chapter. Support keyboard opening, Escape,
   Tab, outside clicks, scrolling, and focus return without rebuilding the list.
3. Update numbering tests and verify menus near pane edges, excluded chapters,
   wrapping, keyboard/focus, scroll, persistence and export metadata. Run the
   required frontend checks, update the dev app and PR 384.

Implemented with shared circular term-action buttons, standard Settings tooltips,
an SVG gear, and the existing editor context-menu surface/item CSS. The menu is
inside the dialog focus scope but outside the scrolling list, clamped to the
dialog bounds. The tooltip hides while the menu is open. Numbered is an accessible
checked menu action; toggling closes it and returns focus to the gear. Outside
clicks, Escape, Tab, scrolling, resizing and window blur dismiss it appropriately.
The removed checkbox row no longer consumes space; the minimum sidebar width
allows both action buttons while retaining title wrapping.

All 29 export browser workflows, 3,093 frontend unit/screen tests and 25 workflow
tests passed. Coverage includes numbering/export persistence, checkmarks, gear
tooltips, menu keyboard behavior, focus return, no list replacement/scroll jump,
excluded chapters, outside dismissal and bounds at 1440/1000/700px. Four targeted
workflows passed against the running dev checkout after the final tooltip cleanup;
the final menu proof was visually checked. Build, changed-module ESLint and
whitespace checks pass; unused-code counts retain the existing 41-file / 16-export
baseline. All scoped changes are mirrored into the dev app, preserving other work.
