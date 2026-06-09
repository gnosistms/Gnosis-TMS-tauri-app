import { syncAutoSizeTextarea } from "../autosize.js";
import {
  describeInlineMarkupSelection,
  toggleInlineMarkupSelection,
} from "../editor-inline-markup.js";

function inlineStyleButtons(root, selector) {
  return Array.from(root?.querySelectorAll?.(selector) ?? []);
}

function focusedResourceTextarea(doc, isResourceTextarea) {
  return isResourceTextarea(doc?.activeElement) ? doc.activeElement : null;
}

function isButtonElement(button) {
  return typeof HTMLElement !== "undefined" && button instanceof HTMLElement;
}

export function createRepoResourceTermInlineMarkupFlow(descriptor) {
  const {
    buttonSelector,
    isResourceTextarea,
    buttonAppliesToTextarea,
    applyDraftUpdate,
    autosizeMaxHeight,
  } = descriptor;

  function buttonMatchesTextarea(button, textarea) {
    return buttonAppliesToTextarea?.(button, textarea) === true;
  }

  function clearInlineStyleButtons(root = document) {
    inlineStyleButtons(root, buttonSelector).forEach((button) => {
      if (!isButtonElement(button)) {
        return;
      }

      button.classList.add("is-disabled");
      button.classList.remove("is-active");
      button.setAttribute("aria-disabled", "true");
      button.setAttribute("aria-pressed", "false");
      button.tabIndex = -1;
    });
  }

  function syncButtons(doc = document) {
    const textarea = focusedResourceTextarea(doc, isResourceTextarea);
    if (!textarea || textarea.disabled || textarea.readOnly) {
      clearInlineStyleButtons(doc);
      return;
    }

    const selection = describeInlineMarkupSelection(
      textarea.value,
      textarea.selectionStart ?? 0,
      textarea.selectionEnd ?? 0,
    );

    inlineStyleButtons(doc, buttonSelector).forEach((button) => {
      if (!isButtonElement(button)) {
        return;
      }

      const appliesToTextarea = buttonMatchesTextarea(button, textarea);
      const isActive = appliesToTextarea && selection.activeStyles?.[button.dataset.inlineStyle ?? ""] === true;
      button.classList.toggle("is-disabled", !appliesToTextarea);
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-disabled", appliesToTextarea ? "false" : "true");
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
      button.tabIndex = appliesToTextarea ? 0 : -1;
    });
  }

  function resolveTargetTextarea(button, doc = document) {
    if (!isButtonElement(button)) {
      return null;
    }

    const textarea = focusedResourceTextarea(doc, isResourceTextarea);
    if (!textarea) {
      return null;
    }

    return buttonMatchesTextarea(button, textarea) ? textarea : null;
  }

  function toggle(button, operations = {}) {
    const doc = operations.document ?? document;
    if (
      !isButtonElement(button)
      || button.getAttribute("aria-disabled") === "true"
      || button.classList.contains("is-disabled")
    ) {
      syncButtons(doc);
      return false;
    }

    const textarea = resolveTargetTextarea(button, doc);
    if (!isResourceTextarea(textarea) || textarea.disabled || textarea.readOnly) {
      syncButtons(doc);
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
      syncButtons(doc);
      return false;
    }

    textarea.value = result.value;
    textarea.setSelectionRange(
      result.selectionStart ?? 0,
      result.selectionEnd ?? 0,
      result.selectionDirection ?? "none",
    );

    applyDraftUpdate?.(textarea, operations);
    (operations.syncAutoSizeTextarea ?? syncAutoSizeTextarea)(textarea, {
      minHeight: 44,
      maxHeight: autosizeMaxHeight,
    });
    syncButtons(doc);
    return true;
  }

  return {
    syncButtons,
    toggle,
  };
}
