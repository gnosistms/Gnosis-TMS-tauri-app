import { applyEditorRowFieldInput } from "./editor-row-input.js";
import { applyEditorFieldEdit } from "./editor-field-undo.js";
import { parseInlineMarkup, sanitizeInlineLinkHref } from "./editor-inline-markup/parser.js";
import { escapeHtml } from "./editor-inline-markup/serialize.js";
import { findElementContainingSelection } from "./editor-inline-markup/ranges.js";
import { buildEditorFieldSelector } from "./editor-utils.js";
import { createEditorInsertLinkModalState, state } from "./state.js";

export function insertLinkEditor(appState, scope) {
  switch (scope) {
    case "editor": return appState.editorChapter;
    case "glossary-term": return appState.glossaryTermEditor;
    case "qa-term": return appState.qaTermEditor;
    default: return null;
  }
}

// Tabbing to a round button moves DOM focus. Keep the last field on this
// instance of the term dialog so either language's button uses its selection.
export function rememberTermLinkField(field) {
  if (!field?.dataset?.termLinkField) return;
  const dialog = field.closest("[data-modal-dialog]");
  if (dialog) dialog.dataset.lastTermLinkField = field.dataset.termLinkField;
}

function resolveTargetTextarea(button, scope) {
  const cluster = button?.closest?.(scope === "editor"
    ? "[data-editor-language-cluster]" : `[data-modal-dialog="${scope}-editor"]`);
  if (!(cluster instanceof HTMLElement)) {
    return null;
  }

  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLTextAreaElement && cluster.contains(activeElement)
    && (scope === "editor" || activeElement.hasAttribute("data-term-link-field"))) {
    return activeElement;
  }

  const field = scope === "editor"
    ? cluster.querySelector("[data-editor-row-field]")
    : cluster.querySelector(`[data-term-link-field="${CSS.escape(cluster.dataset.lastTermLinkField ?? "")}"]`);
  return field instanceof HTMLTextAreaElement ? field : null;
}

function findLinkTextarea(modal, scope) {
  if (typeof document === "undefined") return null;
  const { rowId, languageCode, contentKind, footnoteMarker, fieldKey } = modal;
  const selector = scope === "editor"
    ? buildEditorFieldSelector(rowId, languageCode, contentKind, { footnoteMarker })
    : `[data-modal-dialog="${scope}-editor"] [data-term-link-field="${CSS.escape(fieldKey)}"]`;
  const field = document.querySelector(selector);
  return field instanceof HTMLTextAreaElement ? field : null;
}

function setInsertLinkModalState(scope, modal) {
  if (scope === "editor") {
    state.editorChapter = { ...state.editorChapter, insertLinkModal: modal };
  } else {
    insertLinkEditor(state, scope).insertLinkModal = modal;
  }
}

/**
 * Validates user-typed link input leniently, the way browser address bars do:
 * a missing scheme is normalized to https:// ("google.com/privacy" is valid),
 * while explicit non-http(s) schemes (mailto:, javascript:, ftp://, data:),
 * scheme-less words without a dotted host, and credential-bearing URLs
 * ("google.com@evil.com") are rejected. Returns the normalized href, or ""
 * when the input is not an acceptable link.
 */
export function validateEditorLinkUrl(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return "";
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return sanitizeInlineLinkHref(trimmed);
  }

  // A leading scheme that is not host:port shorthand (google.com:8080,
  // localhost:3000) marks the input as a non-http(s) URL kind.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^[a-z0-9+.-]+:\d/i.test(trimmed)) {
    return "";
  }

  const candidate = trimmed.startsWith("//") ? `https:${trimmed}` : `https://${trimmed}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return "";
  }

  if (parsed.username || parsed.password) {
    return "";
  }

  if (!parsed.hostname.includes(".") && parsed.hostname !== "localhost") {
    return "";
  }

  return sanitizeInlineLinkHref(candidate);
}

function refocusInsertLinkTextarea(modal, scope, { selectionStart, selectionEnd } = modal) {
  const textarea = findLinkTextarea(modal, scope);
  if (!textarea) {
    return;
  }

  textarea.focus({ preventScroll: true });
  if (Number.isInteger(selectionStart) && Number.isInteger(selectionEnd)) {
    textarea.setSelectionRange(selectionStart, selectionEnd);
  }
}

export function openEditorInsertLink(render, button, scope = "editor") {
  const editor = insertLinkEditor(state, scope);
  const canOpen = scope === "editor" ? editor?.chapterId : editor?.isOpen && editor.status !== "loading";
  if (!canOpen) {
    return;
  }

  const textarea = resolveTargetTextarea(button, scope);
  const selectionStart = textarea?.selectionStart ?? 0;
  const selectionEnd = textarea?.selectionEnd ?? 0;
  const hasSelection =
    textarea instanceof HTMLTextAreaElement
    && !textarea.disabled
    && !textarea.readOnly
    && selectionEnd > selectionStart;

  const target = scope === "editor" ? {
    rowId: textarea?.dataset.rowId,
    languageCode: textarea?.dataset.languageCode,
    contentKind: textarea?.dataset.contentKind ?? "field",
    footnoteMarker: textarea?.dataset.footnoteMarker ?? "",
  } : { fieldKey: textarea?.dataset.termLinkField };
  setInsertLinkModalState(scope, {
    ...target,
    isOpen: true,
    mode: hasSelection ? "url" : "no-selection",
    selectionStart,
    selectionEnd,
    selectedText: hasSelection ? textarea.value.slice(selectionStart, selectionEnd) : "",
    urlDraft: "",
  });
  render?.({ scope: "insert-link-modal", linkScope: scope });
}

export function updateEditorInsertLinkUrlDraft(nextValue, scope = "editor") {
  const modal = insertLinkEditor(state, scope)?.insertLinkModal;
  if (modal?.isOpen) setInsertLinkModalState(scope, { ...modal, urlDraft: String(nextValue ?? "") });
}

export function closeEditorInsertLinkModal(render, scope = "editor") {
  const modal = insertLinkEditor(state, scope)?.insertLinkModal;
  if (!modal?.isOpen) {
    return;
  }

  setInsertLinkModalState(scope, createEditorInsertLinkModalState());
  render?.({ scope: "insert-link-modal", linkScope: scope });
  if (modal.mode === "url") refocusInsertLinkTextarea(modal, scope);
}

/**
 * Computes the next markup value for inserting a link on the selection.
 * When the selection sits inside an existing <a> element, that element's
 * href is replaced instead of nesting a second link.
 */
export function applyInsertLinkToValue(value, selectionStart, selectionEnd, href) {
  const source = String(value ?? "");
  const sanitizedHref = sanitizeInlineLinkHref(href);
  if (!sanitizedHref) {
    return null;
  }

  const openTag = `<a href="${escapeHtml(sanitizedHref)}">`;
  const parsed = parseInlineMarkup(source);
  const enclosingLink = findElementContainingSelection(parsed, "a", selectionStart, selectionEnd);
  if (enclosingLink && enclosingLink.openStart >= 0 && enclosingLink.openEnd >= 0) {
    const nextValue =
      source.slice(0, enclosingLink.openStart)
      + openTag
      + source.slice(enclosingLink.openEnd);
    const shift = openTag.length - (enclosingLink.openEnd - enclosingLink.openStart);
    return {
      value: nextValue,
      selectionStart: selectionStart + shift,
      selectionEnd: selectionEnd + shift,
    };
  }

  const nextValue =
    source.slice(0, selectionStart)
    + openTag
    + source.slice(selectionStart, selectionEnd)
    + "</a>"
    + source.slice(selectionEnd);
  return {
    value: nextValue,
    selectionStart: selectionStart + openTag.length,
    selectionEnd: selectionEnd + openTag.length,
  };
}

export function submitEditorInsertLink(render, operations = {}, scope = "editor") {
  const modal = insertLinkEditor(state, scope)?.insertLinkModal;
  if (!modal?.isOpen || modal.mode !== "url") {
    return;
  }

  const href = validateEditorLinkUrl(modal.urlDraft);
  if (!href) {
    return;
  }

  const { selectionStart, selectionEnd, selectedText } = modal;
  const textarea = findLinkTextarea(modal, scope);
  const selectionIntact =
    textarea instanceof HTMLTextAreaElement
    && !textarea.disabled
    && !textarea.readOnly
    && textarea.value.slice(selectionStart, selectionEnd) === selectedText;
  const result = selectionIntact && applyInsertLinkToValue(textarea.value, selectionStart, selectionEnd, href);
  if (!result) {
    closeEditorInsertLinkModal(render, scope);
    return;
  }

  // Remove the dialog before focusing the caption/footnote/main field; the
  // modal controller otherwise traps focus in its URL input.
  setInsertLinkModalState(scope, createEditorInsertLinkModalState());
  render?.({ scope: "insert-link-modal", linkScope: scope });
  applyEditorFieldEdit(textarea, result);
  if (scope === "editor") {
    applyEditorRowFieldInput({ ...operations, input: textarea, render });
  } else {
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }
  refocusInsertLinkTextarea(modal, scope, result);
}

export function termInsertLinkActions(render, scope) {
  return {
    [`open-${scope}-insert-link`]: (event) =>
      openEditorInsertLink(render, event?.target?.closest?.("[data-editor-link-button]"), scope),
    [`submit-${scope}-insert-link`]: () => submitEditorInsertLink(render, {}, scope),
    [`close-${scope}-insert-link-modal`]: () => closeEditorInsertLinkModal(render, scope),
  };
}
