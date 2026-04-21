import { applyEditorRowFieldInput } from "./editor-row-input.js";
import {
  describeInlineMarkupSelection,
  toggleInlineMarkupSelection,
} from "./editor-inline-markup.js";
import { state } from "./state.js";

function languageClusterForButton(button) {
  return button?.closest?.("[data-editor-language-cluster]") ?? null;
}

function clearInlineStyleButtons(root = document) {
  root.querySelectorAll?.("[data-editor-inline-style-button].is-active").forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    button.classList.remove("is-active");
    button.setAttribute("aria-pressed", "false");
  });
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

  return cluster.querySelector("[data-editor-row-field]") instanceof HTMLTextAreaElement
    ? cluster.querySelector("[data-editor-row-field]")
    : null;
}

export function syncEditorInlineStyleButtonsForTextarea(textarea) {
  if (!(textarea instanceof HTMLTextAreaElement)) {
    clearInlineStyleButtons();
    return;
  }

  const cluster = textarea.closest("[data-editor-language-cluster]");
  if (!(cluster instanceof HTMLElement)) {
    clearInlineStyleButtons();
    return;
  }

  const selection = describeInlineMarkupSelection(
    textarea.value,
    textarea.selectionStart ?? 0,
    textarea.selectionEnd ?? 0,
  );
  cluster.querySelectorAll("[data-editor-inline-style-button]").forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    const style = button.dataset.inlineStyle ?? "";
    const isActive = selection.activeStyles?.[style] === true;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

export function syncActiveEditorInlineStyleButtons(doc = document) {
  const activeElement = doc?.activeElement;
  if (!(activeElement instanceof HTMLTextAreaElement) || !activeElement.matches("[data-editor-row-field]")) {
    clearInlineStyleButtons(doc);
    return;
  }

  syncEditorInlineStyleButtonsForTextarea(activeElement);
}

export function toggleEditorInlineStyle(render, button, operations = {}) {
  const textarea = resolveTargetTextarea(button);
  if (!(textarea instanceof HTMLTextAreaElement) || textarea.disabled || textarea.readOnly) {
    return;
  }

  const style = button?.dataset?.inlineStyle ?? "";
  const result = toggleInlineMarkupSelection({
    value: textarea.value,
    selectionStart: textarea.selectionStart ?? 0,
    selectionEnd: textarea.selectionEnd ?? 0,
    selectionDirection: textarea.selectionDirection ?? "none",
    style,
    languageCode: textarea.dataset.languageCode ?? "",
  });
  if (result.changed !== true) {
    syncEditorInlineStyleButtonsForTextarea(textarea);
    return;
  }

  textarea.value = result.value;
  if (typeof result.selectionStart === "number" && typeof result.selectionEnd === "number") {
    textarea.setSelectionRange(
      result.selectionStart,
      result.selectionEnd,
      result.selectionDirection ?? "none",
    );
  }

  applyEditorRowFieldInput({
    input: textarea,
    filters: state.editorChapter?.filters,
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
