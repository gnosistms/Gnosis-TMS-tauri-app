import { editorChapterFiltersAreActive } from "./editor-filters.js";

export function applyEditorRowFieldInput({
  input,
  filters,
  render,
  updateEditorRowFieldValue,
  syncEditorRowTextareaHeight,
  syncEditorVirtualizationRowLayout,
  syncEditorGlossaryHighlightRowDom,
}) {
  const rowId = input?.dataset?.rowId ?? "";
  const languageCode = input?.dataset?.languageCode ?? "";
  updateEditorRowFieldValue(rowId, languageCode, input?.value ?? "");

  if (editorChapterFiltersAreActive(filters)) {
    render({ scope: "translate-body" });
    return;
  }

  syncEditorRowTextareaHeight(input);
  syncEditorGlossaryHighlightRowDom(rowId);
  syncEditorVirtualizationRowLayout(input);
}
