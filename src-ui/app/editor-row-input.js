import { editorChapterFiltersAreActive } from "./editor-filters.js";
import { buildEditorTextStylePlainTextMarkup } from "./editor-text-style.js";

function syncEditorTextStylePreview(input) {
  const fieldStack = typeof input?.closest === "function"
    ? input.closest("[data-editor-glossary-field-stack]")
    : null;
  if (!fieldStack || typeof fieldStack.querySelector !== "function") {
    return;
  }

  const previewLayer = fieldStack.querySelector("[data-editor-text-style-preview]");
  if (!previewLayer || !("innerHTML" in previewLayer)) {
    return;
  }

  previewLayer.innerHTML = buildEditorTextStylePlainTextMarkup(
    fieldStack.dataset.textStyle ?? "",
    input?.value ?? "",
  );
}

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
  syncEditorTextStylePreview(input);
  syncEditorGlossaryHighlightRowDom(rowId);
  syncEditorVirtualizationRowLayout(input);
}
