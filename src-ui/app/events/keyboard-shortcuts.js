import { isMacPlatform } from "../runtime.js";
import { state } from "../state.js";
import { chapterHasSrtSourceFormat } from "../editor-timing.js";
import { activeGlossaryFootnoteInsertionRequest } from "./glossary-tooltip.js";
import { registerEditorFieldUndoEvents, handleEditorFieldUndoShortcut } from "../editor-field-undo.js";

const PAGE_SEARCH_INPUT_SELECTOR = [
  "[data-project-search-input]",
  "[data-glossary-term-search-input]",
  "[data-editor-search-input]",
  "[data-preview-search-input]",
].join(", ");

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

  // Cmd+S / Ctrl+S saves and leaves the field (Shift+Return now breaks a line).
  const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
  const hasModifier = isMacPlatform()
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
  return key === "s" && hasModifier && !event.altKey && !event.shiftKey;
}

// In a row's text and its footnotes a return is a paragraph break, so Shift+Return
// inserts a line break as "<br>\n": the newline shows the break while editing and
// the <br> marks it as a line break. Captions, attributions and subtitle text
// already treat every newline as a line, so they keep the native newline.
function shouldInsertEditorLineBreak(event) {
  if (event.defaultPrevented || event.isComposing) {
    return false;
  }

  const target = event.target;
  if (
    !(target instanceof HTMLTextAreaElement)
    || !target.matches("[data-editor-row-field]")
    || target.disabled
    || target.readOnly
  ) {
    return false;
  }

  const contentKind = target.dataset?.contentKind ?? "";
  if (contentKind !== "" && contentKind !== "footnote") {
    return false;
  }
  if (contentKind === "" && chapterHasSrtSourceFormat(state.editorChapter?.sourceFormats)) {
    return false;
  }

  const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
  return (key === "enter" || key === "return")
    && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
}

// execCommand keeps native undo and passes through the editor's beforeinput
// gate, which may refuse the edit (a stale or read-only row).
function insertEditorLineBreak() {
  document.execCommand("insertText", false, "<br>\n");
}

const EDITOR_INLINE_STYLE_SHORTCUTS = new Map([
  ["b", "bold"],
  ["i", "italic"],
  ["u", "underline"],
]);

function inlineStyleForEditorShortcut(event) {
  if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey || event.shiftKey
    || chapterHasSrtSourceFormat(state.editorChapter?.sourceFormats)) {
    return null;
  }

  const target = event.target;
  if (!(target instanceof HTMLTextAreaElement)
    || !target.matches("[data-editor-row-field]")
    || target.disabled
    || target.readOnly) {
    return null;
  }

  const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
  const hasModifier = isMacPlatform()
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
  return hasModifier ? EDITOR_INLINE_STYLE_SHORTCUTS.get(key) ?? null : null;
}

function shouldFocusPageSearch(event) {
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

export function shouldInsertHoveredGlossaryFootnote(event, hasActiveRequest) {
  if (event.defaultPrevented || event.repeat || event.isComposing || !hasActiveRequest) {
    return false;
  }
  const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
  const hasModifier = isMacPlatform()
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
  return key === "f"
    && hasModifier
    && !event.altKey
    && !event.shiftKey;
}

function focusPageSearchInput(selectContents = false) {
  const input = document.querySelector(PAGE_SEARCH_INPUT_SELECTOR);
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
  registerEditorFieldUndoEvents(document);
  document.addEventListener("keydown", (event) => {
    const glossaryTermModalField = event.target instanceof Element
      ? event.target.closest(
        "[data-glossary-term-variant-input], [data-glossary-term-variant-note-input], [data-glossary-term-notes-input], [data-glossary-term-footnote-input]",
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

    // Dialog-local keyboard behavior is delegated to the modal controller.
    // Page-level shortcuts must not move focus or trigger work behind a modal.
    if (document.querySelector("[data-modal-dialog]")) {
      return;
    }

    if (handleEditorFieldUndoShortcut(event)) return;

    const inlineStyle = inlineStyleForEditorShortcut(event);
    if (inlineStyle) {
      const button = event.target.closest("[data-editor-language-cluster]")
        ?.querySelector(`[data-editor-inline-style-button][data-inline-style="${inlineStyle}"]`);
      if (button instanceof HTMLButtonElement && !button.disabled) {
        event.preventDefault();
        // A programmatic click preserves textarea focus and selection while
        // following the same action/permission path as the formatting button.
        button.click();
      }
      return;
    }

    const glossaryFootnoteRequest = activeGlossaryFootnoteInsertionRequest();
    if (shouldInsertHoveredGlossaryFootnote(event, Boolean(glossaryFootnoteRequest))) {
      event.preventDefault();
      void dispatchAction("insert-hovered-glossary-footnote", event);
      return;
    }

    if (shouldFocusPageSearch(event)) {
      if (focusPageSearchInput(true)) {
        event.preventDefault();
      }
      return;
    }

    if (shouldInsertEditorLineBreak(event)) {
      event.preventDefault();
      insertEditorLineBreak();
      return;
    }

    if (shouldBlurActiveEditorField(event)) {
      // The focusout path saves and collapses via row patching, which
      // preserves the viewport by construction — no snapshot dance needed.
      event.preventDefault();
      event.target.blur();
      return;
    }

    if (!shouldTriggerSyncShortcut(event)) {
      return;
    }

    event.preventDefault();
    void dispatchAction("refresh-page", event);
  });
}
