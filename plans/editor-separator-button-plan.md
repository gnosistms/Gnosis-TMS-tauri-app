# Editor Separator Button Plan

## Summary

Add an `hr` toolbar button for editable translation text fields. The button inserts
the literal `<hr>` token at the caret, or replaces the selected range with `<hr>`.
Static editor text, preview, and exports render the token as a separator.

## Implementation Notes

- Extend inline markup parsing with a zero-width void `hr` node. The canonical token
  is `<hr>`; unsupported variants stay escaped as text.
- Render `hr` safely inside editor/static inline containers as a styled separator
  span, while preview and export serializers split text around separator nodes and
  emit block separators.
- Wire a new `insert-editor-separator` action through the existing editor toolbar
  action path and field input update flow, preserving focus and selection.
- Mirror separator behavior in backend HTML, TXT, Markdown, DOCX, and RTF exports.
  XLSX uses a `---` text fallback inside cells when a field contains `<hr>`.

## Tests

- Parser/serializer tests for canonical `<hr>`, visible/base text behavior, and
  unsupported variants.
- Row render and action tests for toolbar visibility and caret/selection insertion.
- Preview tests for static rendering, WordPress separator block output, and plain
  text fallback.
- Rust export tests for HTML, TXT, Markdown, DOCX, RTF, and XLSX separator handling.
