import { syncAutoSizeTextarea } from "./autosize.js";
import {
  describeInlineMarkupSelection,
  toggleInlineMarkupSelection,
} from "./editor-inline-markup.js";
import { updateQaTermDraftField } from "./qa-list-flow.js";

function isQaTermTextarea(element) {
  return Boolean(
    element
      && typeof element.value === "string"
      && typeof element.selectionStart === "number"
      && typeof element.selectionEnd === "number"
      && typeof element.setSelectionRange === "function"
      && element?.dataset?.qaTermTextInput !== undefined,
  );
}

function qaTermInlineStyleButtons(root = document) {
  return Array.from(root?.querySelectorAll?.("[data-qa-term-inline-style-button]") ?? []);
}

function focusedQaTermTextarea(doc = document) {
  return isQaTermTextarea(doc?.activeElement) ? doc.activeElement : null;
}

function clearQaTermInlineStyleButtons(root = document) {
  qaTermInlineStyleButtons(root).forEach((button) => {
    if (!(button instanceof HTMLElement)) {
      return;
    }

    button.classList.add("is-disabled");
    button.classList.remove("is-active");
    button.setAttribute("aria-disabled", "true");
    button.setAttribute("aria-pressed", "false");
    button.tabIndex = -1;
  });
}

export function syncQaTermInlineStyleButtons(doc = document) {
  const textarea = focusedQaTermTextarea(doc);
  if (!textarea || textarea.disabled || textarea.readOnly) {
    clearQaTermInlineStyleButtons(doc);
    return;
  }

  const selection = describeInlineMarkupSelection(
    textarea.value,
    textarea.selectionStart ?? 0,
    textarea.selectionEnd ?? 0,
  );

  qaTermInlineStyleButtons(doc).forEach((button) => {
    if (!(button instanceof HTMLElement)) {
      return;
    }

    const isActive = selection.activeStyles?.[button.dataset.inlineStyle ?? ""] === true;
    button.classList.remove("is-disabled");
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-disabled", "false");
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
    button.tabIndex = 0;
  });
}

export function toggleQaTermInlineStyle(button, operations = {}) {
  const doc = operations.document ?? document;
  if (
    !(button instanceof HTMLElement)
    || button.getAttribute("aria-disabled") === "true"
    || button.classList.contains("is-disabled")
  ) {
    syncQaTermInlineStyleButtons(doc);
    return false;
  }

  const textarea = focusedQaTermTextarea(doc);
  if (!isQaTermTextarea(textarea) || textarea.disabled || textarea.readOnly) {
    syncQaTermInlineStyleButtons(doc);
    return false;
  }

  const result = toggleInlineMarkupSelection({
    value: textarea.value,
    selectionStart: textarea.selectionStart ?? 0,
    selectionEnd: textarea.selectionEnd ?? 0,
    selectionDirection: textarea.selectionDirection ?? "none",
    style: button?.dataset?.inlineStyle ?? "",
    languageCode: textarea.dataset.languageCode ?? "",
  });
  if (result.changed !== true) {
    syncQaTermInlineStyleButtons(doc);
    return false;
  }

  textarea.value = result.value;
  textarea.setSelectionRange(
    result.selectionStart ?? 0,
    result.selectionEnd ?? 0,
    result.selectionDirection ?? "none",
  );
  updateQaTermDraftField("text", textarea.value);
  (operations.syncAutoSizeTextarea ?? syncAutoSizeTextarea)(textarea, {
    minHeight: 44,
    maxHeight: 132,
  });
  syncQaTermInlineStyleButtons(doc);
  return true;
}
