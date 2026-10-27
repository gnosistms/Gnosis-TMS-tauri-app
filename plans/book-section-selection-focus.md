# Keep section selection from focusing chapter title editors

1. Reproduce section selection with macOS-style button focus behavior: a clicked
   button does not automatically take focus away from a chapter title editor.
2. Explicitly focus the selected section navigation button before rendering and
   declare the selected navigation control as the modal's initial focus target.
   Preserve text-only title editing, keyboard selection and scroll behavior.
3. Verify section switching/reopening plus the export regressions, update the
   running dev checkout with scoped patches, and update PR 384.

Reproduced before the fix: with native mousedown focus suppressed, selecting
front matter kept the chapter editor focused instead of the selected navigation
button. Section buttons now share the existing explicit pointer-focus path, and
the selected section/chapter preview declares initial modal focus.

Verification: all 28 export browser workflows passed, including selection of all
five front-matter types after selecting chapter-title text, and reopening with a
front-matter selection. Four targeted workflows passed on the running dev app.
All 3,093 frontend unit/screen tests and 25 workflow tests passed, along with
production build, scoped ESLint and whitespace checks. The unused-code audit
retains the existing 41-file / 16-export baseline. Checked scoped patches updated
the dev checkout while preserving its other local work.
