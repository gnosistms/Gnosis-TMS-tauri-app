# Undo caption link insertion

Reproduce adding a link to an image caption and undoing it with the platform's
standard Undo shortcut. Trace the native textarea editing transaction and modal
focus path; keep the existing editor row input/save path and mounted field.

1. Add a browser regression for caption link insertion, undo, redo, and saved state.
2. Add isolated field-owned checkpoints for link edits. WebKit can group several
   native edit commands into a single Undo, so link edits must have their own
   boundary while retaining earlier typing and ordinary fields' native history.
3. Verify related main/footnote link edits and platform behavior, run relevant
   checks, mirror the fix into the dev checkout, and commit/push the changes.

Complete. Link-edited fields keep bounded Undo/Redo checkpoints tied to their
mounted textarea. Restores use the existing input/save path and beforeinput
permission gate, preserve earlier typing and IME composition groups, and refuse
to undo newly loaded external content. Other fields retain native Undo. The link
dialog closes before focus returns to the original field.

Validation: 3,104 frontend unit/screen tests and 25 workflow tests passed, plus
three macOS WebKit link workflows and seven Chromium editor workflows covering
links, native Undo, virtual row changes, and related caption/footnote formatting.
Focused ESLint, whitespace checks, the production build, and the unchanged
unused-code baseline passed. Dev source and regression coverage are updated
while preserving unrelated local tests; the caption workflow also passed in
WebKit against the running dev checkout.
