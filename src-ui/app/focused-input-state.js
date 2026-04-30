import {
  buildEditorFieldSelector,
  normalizeEditorContentKind,
} from "./editor-utils.js";

const SUPPORTED_FOCUSED_INPUT_SELECTORS = [
  "[data-team-rename-input]",
  "[data-project-rename-input]",
  "[data-chapter-rename-input]",
  "[data-project-name-input]",
  "[data-invite-user-input]",
  "[data-team-permanent-delete-input]",
  "[data-project-permanent-delete-input]",
  "[data-glossary-title-input]",
  "[data-glossary-source-language-select]",
  "[data-glossary-target-language-select]",
  "[data-glossary-rename-input]",
  "[data-glossary-permanent-delete-input]",
  "[data-glossary-term-search-input]",
  "[data-project-export-format-select]",
  "[data-project-export-language-select]",
  "[data-project-search-input]",
  "[data-editor-search-input]",
  "[data-preview-search-input]",
  "[data-editor-replace-input]",
  "[data-editor-comment-draft]",
  "[data-editor-assistant-draft]",
  "[data-ai-key-input]",
  "[data-ai-settings-detailed-toggle]",
  "[data-ai-settings-provider-select]",
  "[data-ai-settings-model-select]",
];

function focusSnapshotSelector(activeElement) {
  if (activeElement instanceof HTMLTextAreaElement && activeElement.matches("[data-editor-row-field]")) {
    return buildEditorFieldSelector(
      activeElement.dataset.rowId ?? "",
      activeElement.dataset.languageCode ?? "",
      normalizeEditorContentKind(activeElement.dataset.contentKind),
    );
  }

  if (activeElement instanceof HTMLInputElement && activeElement.matches("[data-editor-replace-row-select]")) {
    return `[data-editor-replace-row-select][data-row-id="${activeElement.dataset.rowId}"]`;
  }

  if (activeElement instanceof HTMLSelectElement && activeElement.matches("[data-chapter-glossary-select]")) {
    return `[data-chapter-glossary-select][data-chapter-id="${activeElement.dataset.chapterId}"]`;
  }

  return SUPPORTED_FOCUSED_INPUT_SELECTORS.find((candidate) => activeElement.matches(candidate)) ?? null;
}

export function captureFocusedInputState(doc = document) {
  const activeElement = doc?.activeElement;
  if (
    !(activeElement instanceof HTMLInputElement)
    && !(activeElement instanceof HTMLSelectElement)
    && !(activeElement instanceof HTMLTextAreaElement)
  ) {
    return null;
  }

  const selector = focusSnapshotSelector(activeElement);
  if (!selector) {
    return null;
  }

  const isEditorRowField =
    activeElement instanceof HTMLTextAreaElement
    && activeElement.matches("[data-editor-row-field]");
  const contentKind = isEditorRowField
    ? normalizeEditorContentKind(activeElement.dataset.contentKind)
    : "field";

  return {
    kind: isEditorRowField ? "editor-row-field" : "generic",
    selector,
    rowId: isEditorRowField ? (activeElement.dataset.rowId ?? "") : "",
    languageCode: isEditorRowField ? (activeElement.dataset.languageCode ?? "") : "",
    contentKind,
    selectionStart:
      activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement
        ? activeElement.selectionStart
        : null,
    selectionEnd:
      activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement
        ? activeElement.selectionEnd
        : null,
    selectionDirection:
      activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement
        ? activeElement.selectionDirection
        : null,
  };
}

export function restoreFocusedInputState(focusSnapshot, doc = document) {
  if (!focusSnapshot) {
    return false;
  }

  const nextInput = doc?.querySelector?.(focusSnapshot.selector);
  if (
    (!(nextInput instanceof HTMLInputElement)
      && !(nextInput instanceof HTMLSelectElement)
      && !(nextInput instanceof HTMLTextAreaElement))
    || nextInput.disabled
  ) {
    return false;
  }

  nextInput.focus({ preventScroll: true });

  if (
    (nextInput instanceof HTMLInputElement || nextInput instanceof HTMLTextAreaElement)
    && typeof focusSnapshot.selectionStart === "number"
    && typeof focusSnapshot.selectionEnd === "number"
  ) {
    nextInput.setSelectionRange(
      focusSnapshot.selectionStart,
      focusSnapshot.selectionEnd,
      focusSnapshot.selectionDirection ?? "none",
    );
  }

  return true;
}

export function shouldRestoreFocusedInputStateForScope(focusSnapshot, scope = "full") {
  if (!focusSnapshot) {
    return false;
  }

  if (focusSnapshot.kind !== "editor-row-field") {
    return true;
  }

  return scope === "translate-body" || scope === "full";
}
