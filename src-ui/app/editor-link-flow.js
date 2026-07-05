import { applyEditorRowFieldInput } from "./editor-row-input.js";
import { parseInlineMarkup, sanitizeInlineLinkHref } from "./editor-inline-markup/parser.js";
import { escapeHtml } from "./editor-inline-markup/serialize.js";
import { findElementContainingSelection } from "./editor-inline-markup/ranges.js";
import { buildEditorFieldSelector } from "./editor-utils.js";
import { createEditorInsertLinkModalState, state } from "./state.js";

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

function findClusterTextarea(rowId, languageCode, contentKind = "field", footnoteMarker = "") {
  if (typeof document === "undefined" || !rowId || !languageCode) {
    return null;
  }

  const field = document.querySelector(
    buildEditorFieldSelector(rowId, languageCode, contentKind, { footnoteMarker }),
  );
  return field instanceof HTMLTextAreaElement ? field : null;
}

function setInsertLinkModalState(nextModalState) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    insertLinkModal: {
      ...createEditorInsertLinkModalState(),
      ...(nextModalState && typeof nextModalState === "object" ? nextModalState : {}),
    },
  };
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

function focusInsertLinkUrlInput() {
  if (typeof window === "undefined") {
    return;
  }

  window.requestAnimationFrame(() => {
    const input = document.querySelector("[data-editor-insert-link-url-input]");
    if (input instanceof HTMLInputElement) {
      input.focus({ preventScroll: true });
    }
  });
}

function refocusInsertLinkTextarea(rowId, languageCode, selectionStart, selectionEnd, contentKind = "field", footnoteMarker = "") {
  if (typeof window === "undefined") {
    return;
  }

  window.requestAnimationFrame(() => {
    const textarea = findClusterTextarea(rowId, languageCode, contentKind, footnoteMarker);
    if (!(textarea instanceof HTMLTextAreaElement)) {
      return;
    }

    textarea.focus({ preventScroll: true });
    if (Number.isInteger(selectionStart) && Number.isInteger(selectionEnd)) {
      textarea.setSelectionRange(selectionStart, selectionEnd);
    }
  });
}

export function openEditorInsertLink(render, button) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  const textarea = resolveTargetTextarea(button);
  // Target whichever field the user was actually editing — main text, footnote,
  // or image caption — not just the cluster's first (main) field.
  const rowId = textarea?.dataset?.rowId ?? button?.dataset?.rowId ?? "";
  const languageCode = textarea?.dataset?.languageCode ?? button?.dataset?.languageCode ?? "";
  const contentKind = textarea?.dataset?.contentKind ?? "field";
  const footnoteMarker = textarea?.dataset?.footnoteMarker ?? "";
  const selectionStart = textarea?.selectionStart ?? 0;
  const selectionEnd = textarea?.selectionEnd ?? 0;
  const hasSelection =
    textarea instanceof HTMLTextAreaElement
    && !textarea.disabled
    && !textarea.readOnly
    && selectionEnd > selectionStart;

  if (!hasSelection) {
    setInsertLinkModalState({
      isOpen: true,
      mode: "no-selection",
    });
    render?.({ scope: "translate-insert-link-modal" });
    return;
  }

  setInsertLinkModalState({
    isOpen: true,
    mode: "url",
    rowId,
    languageCode,
    contentKind,
    footnoteMarker,
    selectionStart,
    selectionEnd,
    selectedText: textarea.value.slice(selectionStart, selectionEnd),
    urlDraft: "",
  });
  render?.({ scope: "translate-insert-link-modal" });
  focusInsertLinkUrlInput();
}

export function updateEditorInsertLinkUrlDraft(nextValue) {
  if (!state.editorChapter?.insertLinkModal?.isOpen) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    insertLinkModal: {
      ...state.editorChapter.insertLinkModal,
      urlDraft: String(nextValue ?? ""),
    },
  };
}

export function closeEditorInsertLinkModal(render) {
  const modal = state.editorChapter?.insertLinkModal;
  if (!modal?.isOpen) {
    return;
  }

  const { mode, rowId, languageCode, contentKind, footnoteMarker, selectionStart, selectionEnd } = modal;
  setInsertLinkModalState(null);
  render?.({ scope: "translate-insert-link-modal" });
  if (mode === "url") {
    refocusInsertLinkTextarea(rowId, languageCode, selectionStart, selectionEnd, contentKind, footnoteMarker);
  }
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

export function submitEditorInsertLink(render, operations = {}) {
  const modal = state.editorChapter?.insertLinkModal;
  if (!modal?.isOpen || modal.mode !== "url") {
    return;
  }

  const href = validateEditorLinkUrl(modal.urlDraft);
  if (!href) {
    return;
  }

  const { rowId, languageCode, contentKind, footnoteMarker, selectionStart, selectionEnd, selectedText } = modal;
  const textarea = findClusterTextarea(rowId, languageCode, contentKind, footnoteMarker);
  const selectionIntact =
    textarea instanceof HTMLTextAreaElement
    && !textarea.disabled
    && !textarea.readOnly
    && textarea.value.slice(selectionStart, selectionEnd) === selectedText;
  if (!selectionIntact) {
    closeEditorInsertLinkModal(render);
    return;
  }

  const result = applyInsertLinkToValue(textarea.value, selectionStart, selectionEnd, href);
  if (!result) {
    closeEditorInsertLinkModal(render);
    return;
  }

  textarea.value = result.value;
  textarea.setSelectionRange(result.selectionStart, result.selectionEnd);
  applyEditorRowFieldInput({
    input: textarea,
    render,
    updateEditorRowFieldValueForContentKind: operations.updateEditorRowFieldValueForContentKind,
    syncEditorRowTextareaHeight: operations.syncEditorRowTextareaHeight,
    syncEditorVirtualizationRowLayout: operations.syncEditorVirtualizationRowLayout,
    syncEditorGlossaryHighlightRowDom: operations.syncEditorGlossaryHighlightRowDom,
  });

  setInsertLinkModalState(null);
  render?.({ scope: "translate-insert-link-modal" });
  refocusInsertLinkTextarea(rowId, languageCode, result.selectionStart, result.selectionEnd, contentKind, footnoteMarker);
}
