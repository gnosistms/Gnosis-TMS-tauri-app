import { isMacPlatform } from "../runtime.js";
import { state } from "../state.js";
import { chapterHasSrtSourceFormat } from "../editor-timing.js";
import { activeGlossaryFootnoteInsertionRequest } from "./glossary-tooltip.js";
import { registerEditorFieldUndoEvents, handleEditorFieldUndoShortcut } from "../editor-field-undo.js";
import { listIndentEdit, listReturnEdit } from "../editor-list-keys.js";

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

// Cmd+S / Ctrl+S is the one save shortcut: row fields, the image URL field and
// the glossary and QA term editors. Handled in a field, it also keeps the native
// "Sync with Server" menu item (Cmd+S on macOS) from firing.
export function isSaveShortcut(event) {
  if (event.defaultPrevented || event.repeat || event.isComposing) {
    return false;
  }
  const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
  const hasModifier = isMacPlatform()
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
  return key === "s" && hasModifier && !event.altKey && !event.shiftKey;
}

function shouldBlurActiveEditorField(event) {
  const target = event.target;
  if (!(target instanceof HTMLTextAreaElement) || !target.matches("[data-editor-row-field]")) {
    return false;
  }

  if (target.disabled || target.readOnly) {
    return false;
  }

  // Cmd+S / Ctrl+S saves and leaves the field (Shift+Return now breaks a line).
  return isSaveShortcut(event);
}

const TERM_EDITOR_SAVE_ACTIONS = new Map([
  ["glossary-term-editor", "submit-glossary-term-editor"],
  ["qa-term-editor", "submit-qa-term-editor"],
]);

function termEditorSaveAction(event) {
  const dialog = event.target instanceof Element ? event.target.closest("[data-modal-dialog]") : null;
  const action = TERM_EDITOR_SAVE_ACTIONS.get(dialog?.getAttribute("data-modal-dialog") ?? "");
  return action && isSaveShortcut(event) ? action : null;
}

// Row text splits into paragraphs at blank lines, so Return inserts one: two
// newlines, or one when the caret already follows a newline. Shift+Return keeps
// the native single newline, a line break. Subtitle text, custom HTML,
// footnotes, captions and attributions keep native newlines throughout.
function shouldInsertEditorParagraphBreak(event) {
  if (event.defaultPrevented || event.isComposing) {
    return false;
  }

  const target = event.target;
  if (
    !(target instanceof HTMLTextAreaElement)
    || !target.matches("[data-editor-row-field][data-text-has-paragraphs]")
    || target.disabled
    || target.readOnly
  ) {
    return false;
  }

  const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
  return (key === "enter" || key === "return")
    && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
}

// execCommand keeps native undo and passes through the editor's beforeinput
// gate, which may refuse the edit (a stale or read-only row).
function insertEditorParagraphBreak(textarea) {
  const before = textarea.value.slice(0, textarea.selectionStart);
  document.execCommand("insertText", false, before === "" || before.endsWith("\n") ? "\n" : "\n\n");
}

// List rows: every line is an item and its leading tabs are its level. Return
// (with or without Shift) starts an item at the same level, Tab and Shift+Tab
// indent and outdent.
function editorListKeyEdit(event) {
  if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) {
    return null;
  }

  const target = event.target;
  if (
    !(target instanceof HTMLTextAreaElement)
    || !target.matches("[data-editor-row-field][data-text-is-list]")
    || target.disabled
    || target.readOnly
  ) {
    return null;
  }

  const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
  if (key === "enter" || key === "return") {
    return { edit: listReturnEdit(target.value, target.selectionStart, target.selectionEnd) };
  }
  if (key === "tab") {
    return { edit: listIndentEdit(target.value, target.selectionStart, target.selectionEnd, event.shiftKey) };
  }
  return null;
}

// Like the paragraph break, through execCommand for native undo and the
// editor's beforeinput gate.
function applyEditorListKeyEdit(textarea, edit) {
  textarea.setSelectionRange(edit.start, edit.end);
  if (edit.text) {
    document.execCommand("insertText", false, edit.text);
  } else {
    document.execCommand("delete");
  }
  textarea.setSelectionRange(edit.selectionStart, edit.selectionEnd);
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
    const termEditorAction = termEditorSaveAction(event);
    if (termEditorAction) {
      event.preventDefault();
      void dispatchAction(termEditorAction, event);
      return;
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

    const listKeyEdit = editorListKeyEdit(event);
    if (listKeyEdit) {
      // Tab stays in a list field even when the item cannot move.
      event.preventDefault();
      if (listKeyEdit.edit) {
        applyEditorListKeyEdit(event.target, listKeyEdit.edit);
      }
      return;
    }

    if (shouldInsertEditorParagraphBreak(event)) {
      event.preventDefault();
      insertEditorParagraphBreak(event.target);
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
