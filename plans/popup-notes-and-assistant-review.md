# Glossary popup notes and Assistant review scope

## Scope

- Label global glossary notes “Note to Translators:” and label footnotes only
  when translator notes are also present. Keep labels close to their content.
- Show indented translation usage notes in source-language popups; omit them
  from target-language popups, which show only the hovered translation.
- Include the active target body, numbered footnotes, and image caption in
  Assistant review context, including current unsaved edits and cleared fields.
  Keep footnote/caption corrections in the reply and body draft text separate.

## Delivery

1. Copy only the reviewed popup and Assistant changes onto current main in an
   isolated checkout. Preserve unrelated local source and dev launcher/version work.
2. Run the frontend suite, focused native Assistant regressions, lint/format checks,
   and existing popup browser tests. Verify the final diff and unchanged cache
   context when target notes/captions change. No live AI provider calls are needed.
3. Open one PR, check GitHub results, and merge using the standard merge endpoint.

The Assistant request uses backward-compatible defaults and sends mutable target
sections in each turn without changing its cached source context/history.

## Validation

- All 2,979 app tests and 25 workflow tests pass in the isolated checkout.
- JavaScript lint passes with existing warnings; Rust formatting passes.
- The unused-code audit output is byte-for-byte identical to main's baseline.
- The 20 native Assistant tests passed during implementation, including numbered
  footnotes, caption edits/clearing, and cache-prefix preservation.
- Existing popup browser tests run against this checkout on a separate port.
