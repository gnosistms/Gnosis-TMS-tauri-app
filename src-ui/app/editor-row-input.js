import { editorChapterFiltersAreActive } from "./editor-filters.js";

export function applyEditorRowFieldInput({
  input,
  filters,
  render,
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

  if (typeof updateEditorRowFieldValueForContentKind === "function") {
    updateEditorRowFieldValueForContentKind(rowId, languageCode, nextValue, contentKind);
  } else if (typeof updateEditorRowFieldValue === "function") {
    updateEditorRowFieldValue(rowId, languageCode, nextValue);
  }

  if (editorChapterFiltersAreActive(filters)) {
    render({ scope: "translate-body" });
    return;
  }

  syncEditorRowTextareaHeight(input);
  syncEditorGlossaryHighlightRowDom(rowId);
  syncEditorVirtualizationRowLayout(input);
}
