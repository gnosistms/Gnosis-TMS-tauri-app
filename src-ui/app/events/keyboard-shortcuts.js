import { isMacPlatform } from "../runtime.js";
import {
  captureTranslateAnchorForRow,
} from "../scroll-state.js";
import {
  captureTranslateViewport,
  restoreTranslateViewportAfterPaints,
} from "../translate-viewport.js";

function shouldTriggerSyncShortcut(event) {
  if (event.defaultPrevented || event.repeat) {
    return false;
  }

  const target = event.target;
  if (
    target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target?.isContentEditable === true
  ) {
    return false;
  }

  const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
  if (isMacPlatform()) {
    return event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && key === "s";
  }

  return event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && key === "r";
}

function shouldBlurActiveEditorField(event) {
  if (event.defaultPrevented || event.repeat || event.isComposing) {
    return false;
  }

  const target = event.target;
  if (!(target instanceof HTMLTextAreaElement) || !target.matches("[data-editor-row-field]")) {
    return false;
  }

  if (target.disabled || target.readOnly) {
    return false;
  }

  const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
  return key === "enter" && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
}

function shouldFocusEditorSearch(event) {
  if (event.defaultPrevented || event.repeat || event.isComposing) {
    return false;
  }

  const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
  if (key !== "f" || event.shiftKey || event.altKey) {
    return false;
  }

  if (isMacPlatform()) {
    return event.metaKey && !event.ctrlKey;
  }

  return event.ctrlKey && !event.metaKey;
}

function focusEditorSearchInput(selectContents = false) {
  const input = document.querySelector("[data-editor-search-input]");
  if (!(input instanceof HTMLInputElement)) {
    return false;
  }

  input.focus({ preventScroll: true });
  if (selectContents) {
    input.select();
  }
  return true;
}

export function registerKeyboardShortcutEvents(dispatchAction) {
  document.addEventListener("keydown", (event) => {
    if (shouldFocusEditorSearch(event)) {
      if (focusEditorSearchInput(true)) {
        event.preventDefault();
      }
      return;
    }

    const glossaryTermModalField = event.target instanceof Element
      ? event.target.closest(
        "[data-glossary-term-variant-input], [data-glossary-term-notes-input], [data-glossary-term-footnote-input]",
      )
      : null;
    if (glossaryTermModalField instanceof HTMLTextAreaElement) {
      const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
      if (
        (key === "enter" || key === "return")
        && event.shiftKey
        && !event.metaKey
        && !event.ctrlKey
        && !event.altKey
      ) {
        event.preventDefault();
        void dispatchAction("submit-glossary-term-editor", event);
        return;
      }
    }

    if (shouldBlurActiveEditorField(event)) {
      const viewportSnapshot = captureTranslateViewport(event.target);
      const contentKind = event.target.dataset.contentKind ?? "";
      if (contentKind === "" || contentKind === "image-caption") {
        viewportSnapshot.anchor =
          captureTranslateAnchorForRow(
            event.target.dataset.rowId ?? "",
            event.target.dataset.languageCode ?? "",
            { preferRow: true },
          ) ?? viewportSnapshot.anchor;
      }
      event.preventDefault();
      event.target.blur();
      restoreTranslateViewportAfterPaints(viewportSnapshot);
      return;
    }

    if (!shouldTriggerSyncShortcut(event)) {
      return;
    }

    event.preventDefault();
    void dispatchAction("refresh-page", event);
  });
}
