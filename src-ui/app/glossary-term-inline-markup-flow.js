import { syncAutoSizeTextarea } from "./autosize.js";
import {
  describeInlineMarkupSelection,
  toggleInlineMarkupSelection,
} from "./editor-inline-markup.js";
import { updateGlossaryTermVariant } from "./glossary-term-draft.js";

function isGlossaryVariantTextarea(element) {
  return Boolean(
    element
      && typeof element.value === "string"
      && typeof element.selectionStart === "number"
      && typeof element.selectionEnd === "number"
      && typeof element.setSelectionRange === "function"
      && element?.dataset?.variantSide
      && element?.dataset?.variantIndex !== undefined,
  );
}

function glossaryInlineStyleButtons(root = document) {
  return Array.from(root?.querySelectorAll?.("[data-glossary-inline-style-button]") ?? []);
}

function focusedGlossaryVariantTextarea(doc = document) {
  return isGlossaryVariantTextarea(doc?.activeElement) ? doc.activeElement : null;
}

function clearGlossaryInlineStyleButtons(root = document) {
  glossaryInlineStyleButtons(root).forEach((button) => {
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

export function syncGlossaryTermInlineStyleButtons(doc = document) {
  const textarea = focusedGlossaryVariantTextarea(doc);
  if (!textarea || textarea.disabled || textarea.readOnly) {
    clearGlossaryInlineStyleButtons(doc);
    return;
  }

  const selection = describeInlineMarkupSelection(
    textarea.value,
    textarea.selectionStart ?? 0,
    textarea.selectionEnd ?? 0,
  );
  const activeSide = textarea.dataset.variantSide ?? "";

  glossaryInlineStyleButtons(doc).forEach((button) => {
    if (!(button instanceof HTMLElement)) {
      return;
    }

    const isMatchingSide = button.dataset.variantSide === activeSide;
    const isActive = isMatchingSide && selection.activeStyles?.[button.dataset.inlineStyle ?? ""] === true;
    button.classList.toggle("is-disabled", !isMatchingSide);
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-disabled", isMatchingSide ? "false" : "true");
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
    button.tabIndex = isMatchingSide ? 0 : -1;
  });
}

function resolveTargetTextarea(button, doc = document) {
  if (!(button instanceof HTMLElement)) {
    return null;
  }

  const textarea = focusedGlossaryVariantTextarea(doc);
  if (!textarea) {
    return null;
  }

  return textarea.dataset.variantSide === button.dataset.variantSide ? textarea : null;
}

export function toggleGlossaryTermInlineStyle(button, operations = {}) {
  const doc = operations.document ?? document;
  if (
    !(button instanceof HTMLElement)
    || button.getAttribute("aria-disabled") === "true"
    || button.classList.contains("is-disabled")
  ) {
    syncGlossaryTermInlineStyleButtons(doc);
    return false;
  }

  const textarea = resolveTargetTextarea(button, doc);
  if (!isGlossaryVariantTextarea(textarea) || textarea.disabled || textarea.readOnly) {
    syncGlossaryTermInlineStyleButtons(doc);
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
    syncGlossaryTermInlineStyleButtons(doc);
    return false;
  }

  textarea.value = result.value;
  textarea.setSelectionRange(
    result.selectionStart ?? 0,
    result.selectionEnd ?? 0,
    result.selectionDirection ?? "none",
  );

  const side = textarea.dataset.variantSide ?? "";
  const index = Number.parseInt(textarea.dataset.variantIndex ?? "", 10);
  if ((side === "source" || side === "target") && Number.isInteger(index) && index >= 0) {
    (operations.updateGlossaryTermVariant ?? updateGlossaryTermVariant)(side, index, textarea.value);
  }
  (operations.syncAutoSizeTextarea ?? syncAutoSizeTextarea)(textarea, {
    minHeight: 44,
    maxHeight: 96,
  });
  syncGlossaryTermInlineStyleButtons(doc);
  return true;
}
