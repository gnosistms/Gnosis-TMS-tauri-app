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
  cancelPendingTranslateViewportRestores,
  captureTranslateViewport,
  renderTranslateBodyPreservingViewport,
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

  cancelPendingTranslateViewportRestores?.();

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

  if (editorChapterFiltersAreActive(filters)) {
    // A filtered body re-render rebuilds every row via innerHTML, so the focused
    // textarea is recreated at its collapsed default height and only regrown by
    // autosize after the scroll/anchor restore runs. That late reflow pushes the
    // caret row away from where the user is looking — the per-keystroke scroll
    // jump. Preserve the viewport across the re-render so the focused row stays
    // put, mirroring the search-filter and AI-translate body re-render paths.
    if (
      typeof captureTranslateViewport === "function"
      && typeof renderTranslateBodyPreservingViewport === "function"
    ) {
      const viewportSnapshot = captureTranslateViewport(input);
      renderTranslateBodyPreservingViewport(render, viewportSnapshot);
    } else {
      render({ scope: "translate-body" });
    }
    return;
  }

  syncEditorRowTextareaHeight(input);
  syncEditorGlossaryHighlightRowDom(rowId);
  syncEditorVirtualizationRowLayout(input);
}
