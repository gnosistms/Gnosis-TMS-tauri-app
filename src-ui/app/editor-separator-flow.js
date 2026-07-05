import { applyEditorRowFieldInput } from "./editor-row-input.js";
import { state } from "./state.js";
import { syncEditorInlineStyleButtonsForTextarea } from "./editor-inline-markup-flow.js";

const EDITOR_SEPARATOR_TOKEN = "<hr>";

function languageClusterForButton(button) {
  return button?.closest?.("[data-editor-language-cluster]") ?? null;
}

function resolveTargetTextarea(button) {
  const cluster = languageClusterForButton(button);
  if (!(cluster instanceof HTMLElement)) {
    return null;
  }

  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLTextAreaElement && cluster.contains(activeElement)) {
    return activeElement;
  }

  const field = cluster.querySelector("[data-editor-row-field]");
  return field instanceof HTMLTextAreaElement ? field : null;
}

export function applyInsertSeparatorToValue(value, selectionStart, selectionEnd) {
  const source = String(value ?? "");
  const start = Math.max(0, Math.min(source.length, Number.parseInt(selectionStart ?? "", 10) || 0));
  const end = Math.max(start, Math.min(source.length, Number.parseInt(selectionEnd ?? "", 10) || 0));
  const nextCursor = start + EDITOR_SEPARATOR_TOKEN.length;
  return {
    value: source.slice(0, start) + EDITOR_SEPARATOR_TOKEN + source.slice(end),
    selectionStart: nextCursor,
    selectionEnd: nextCursor,
  };
}

export function insertEditorSeparator(render, button, operations = {}) {
  const textarea = resolveTargetTextarea(button);
  if (!(textarea instanceof HTMLTextAreaElement) || textarea.disabled || textarea.readOnly) {
    return;
  }

  const result = applyInsertSeparatorToValue(
    textarea.value,
    textarea.selectionStart ?? 0,
    textarea.selectionEnd ?? 0,
  );

  textarea.value = result.value;
  textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
  textarea.focus({ preventScroll: true });

  applyEditorRowFieldInput({
    input: textarea,
    render,
    updateEditorRowFieldValueForContentKind: operations.updateEditorRowFieldValueForContentKind,
    syncEditorRowTextareaHeight: operations.syncEditorRowTextareaHeight,
    syncEditorVirtualizationRowLayout: operations.syncEditorVirtualizationRowLayout,
    syncEditorGlossaryHighlightRowDom: operations.syncEditorGlossaryHighlightRowDom,
  });

  if (
    state.editorChapter?.sidebarTab === "review"
    && state.editorChapter?.activeRowId === (textarea.dataset.rowId ?? "")
    && state.editorChapter?.activeLanguageCode === (textarea.dataset.languageCode ?? "")
  ) {
    render?.({ scope: "translate-sidebar" });
  }

  syncEditorInlineStyleButtonsForTextarea(textarea);
}
