export function applyEditorRowFieldInput({
  input,
  updateEditorRowFieldValueForContentKind,
  updateEditorRowFieldValue,
  syncEditorRowTextareaHeight,
  syncEditorVirtualizationRowLayout,
  syncEditorGlossaryHighlightRowDom,
}) {
  const rowId = input?.dataset?.rowId ?? "";
  const languageCode = input?.dataset?.languageCode ?? "";
  const contentKind =
    input?.dataset?.contentKind === "footnote"
      ? "footnote"
      : input?.dataset?.contentKind === "image-caption"
        ? "image-caption"
        : "field";
  const nextValue = input?.value ?? "";
  const footnoteMarker = input?.dataset?.footnoteMarker ?? null;


  if (typeof updateEditorRowFieldValueForContentKind === "function") {
    if (contentKind === "footnote") {
      updateEditorRowFieldValueForContentKind(rowId, languageCode, nextValue, contentKind, {
        marker: footnoteMarker,
      });
    } else {
      updateEditorRowFieldValueForContentKind(rowId, languageCode, nextValue, contentKind);
    }
  } else if (typeof updateEditorRowFieldValue === "function") {
    updateEditorRowFieldValue(rowId, languageCode, nextValue);
  }

  // Always update the focused field in place — never re-render the whole body on a
  // keystroke. A body re-render rebuilds every row via innerHTML, which recreates the
  // focused textarea and wipes the browser's native undo stack (Cmd/Ctrl+Z). The
  // filtered view used to re-render here, so undo silently broke whenever any filter
  // was active. The edited field shows a plain textarea (no search/glossary highlight)
  // while focused, so the body re-render bought nothing visible; the filtered row set
  // and highlights are refreshed on blur instead.
  syncEditorRowTextareaHeight(input);
  syncEditorGlossaryHighlightRowDom(rowId);
  syncEditorVirtualizationRowLayout(input);
}
