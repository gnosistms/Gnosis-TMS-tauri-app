# AI Assistant review of all target-language sections

1. Include the active row's target footnotes (with marker identities) and target
   image caption alongside its body text in every Assistant request. Use current
   editor values, including unsaved edits.
2. Extend the native request and Assistant prompt with separate current target
   sections. Tell the Assistant that spelling/grammar review covers all three,
   preserve footnote markers, and keep footnote/caption corrections out of the
   body-only translation draft. Send empty sections too, so cleared text cannot
   be resurrected from conversation history. Keep these mutable sections in the
   per-turn prompt to preserve the existing context cache.
3. Add focused request/prompt regressions for body+multiple footnotes+caption,
   later edits, and cleared text. Run frontend and native checks without paid
   model calls or opening the installed application.

Preserve all pre-existing working changes. This changes the chat Assistant's
review context; it does not change glossary/QA resource behavior or credentials.

## Completed

- Assistant requests now include the selected target language's numbered footnotes
  and image caption, read from current editor state alongside the body text.
- The native request accepts these sections with backward-compatible defaults.
  Each turn supplies their current values explicitly, including cleared sections.
- The prompt instructs spelling/grammar review to cover all target sections and
  identifies footnote/caption corrections in the reply. The body-only draft stays
  separate. Mutable sections do not invalidate the cached source context/history.
- 121 AI flow/settings tests, 39 related Assistant/context/footnote tests, and
  20 native Assistant tests pass. Scoped whitespace checks pass; ESLint has no
  errors and retains an existing unused-payload warning outside this change.
- No live provider calls, credential changes, or installed-app launches were made.
