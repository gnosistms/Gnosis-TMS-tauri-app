# Wrap chapter titles within the export list

1. Bound the sidebar, list, cards and title track so long titles cannot enlarge
   the grid or hide include/exclude controls. Let chapter cards grow vertically,
   reserving the Numbered row so selection does not change card height.
2. Use a soft-wrapping textarea over the existing text measure. Preserve the
   text-only edit target, blank-space preview action, focus/caret, and Enter-to-
   save behavior through the shared modal controller (including IME).
3. Verify long Vietnamese titles and unbroken strings at several viewport sizes,
   plus the existing editing/scroll/numbering/inclusion/footer workflows. Mirror
   scoped changes into the dev app and update PR 384.

Implemented with bounded grid tracks, an auto-height text measure and a
soft-wrapping textarea. Drag/include/exclude controls have explicit grid cells.
Every card reserves its Numbered row, keeping selection and checkbox toggles
from changing card height. Only marked title textareas blur on Enter; ordinary
textareas retain their existing newline behavior and IME composition is preserved.

Verified: all 27 export browser workflows, 3,093 frontend unit/screen tests and
25 workflow tests passed. The wrapping test covers Vietnamese text, unbroken
strings, retained button visibility, no horizontal overflow, complete visible
text, Enter-to-save and the fixed footer at 1440/1000/700px. The live dev checkout
passes the new wrapping test and the existing title-click, Enter and numbering
checks. The browser proof was visually inspected. Production build, scoped
ESLint and whitespace checks pass; unused-code counts match the existing
41-file / 16-export baseline. All changes are mirrored into the running dev app.
