// The glossary entry button on each editor language panel works on the text
// highlighted in that panel. This module reads the highlight from the page,
// keeps the buttons' enabled look in step with it, and says how a language
// relates to the chapter's glossary (source, target, or another language).

import { extractInlineMarkupBaseText } from "./editor-inline-markup.js";

export const GLOSSARY_ENTRY_TOOLTIP =
  "Highlight any word or group of words, then click here to make a glossary entry for it.";
export const GLOSSARY_ENTRY_OTHER_LANGUAGE_TOOLTIP =
  "Identify the source language term that corresponds to this word and research its meaning.";

const BUTTON_SELECTOR = "[data-editor-glossary-entry-button]";
// Tags of the editor's inline markup; a highlight that starts or ends inside
// a tagged stretch leaves a stray half of the pair behind.
const STRAY_MARKUP_TAG = /<\/?(?:strong|em|u|ruby|rt|a|hr|b|i)\b[^>]*>/giu;

let enabledKey = "";
let lastSelection = null;

function selectionKey(rowId, languageCode) {
  return rowId && languageCode ? `${rowId}\u0000${languageCode}` : "";
}

function cleanSelectedText(text) {
  return String(text ?? "").replace(/\s+/gu, " ").trim();
}

function panelOf(node) {
  const element = node?.nodeType === 1 ? node : node?.parentElement;
  return element?.closest?.("[data-editor-language-panel]") ?? null;
}

function selectionIn(panel, text) {
  const cleaned = cleanSelectedText(text);
  const rowId = panel?.dataset?.rowId ?? "";
  const languageCode = panel?.dataset?.languageCode ?? "";
  return cleaned && rowId && languageCode ? { rowId, languageCode, text: cleaned } : null;
}

/** Text highlighted in an editor language panel: { rowId, languageCode, text }, or null. */
export function readEditorTextSelection(doc = globalThis.document) {
  if (!doc) return null;
  const active = doc.activeElement;
  if (active?.tagName === "TEXTAREA") {
    const panel = panelOf(active);
    const { selectionStart: start, selectionEnd: end } = active;
    if (!panel || !Number.isInteger(start) || !Number.isInteger(end) || start === end) return null;
    const raw = active.value.slice(Math.min(start, end), Math.max(start, end));
    return selectionIn(panel, extractInlineMarkupBaseText(raw).replace(STRAY_MARKUP_TAG, ""));
  }
  const selection = doc.getSelection?.();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const panel = panelOf(selection.anchorNode);
  if (!panel || panel !== panelOf(selection.focusNode)) return null;
  return selectionIn(panel, selection.toString());
}

/** Whether a panel's button should look enabled when it is (re)drawn. */
export function editorGlossaryEntryButtonEnabled(rowId, languageCode) {
  return Boolean(enabledKey) && enabledKey === selectionKey(rowId, languageCode);
}

/**
 * The highlighted text for the button of this row and language. A keyboard
 * user who tabs to the button has moved focus off the text, so the last
 * highlight seen is used while the button itself has focus.
 */
export function editorGlossaryEntrySelectionFor(rowId, languageCode, doc = globalThis.document) {
  const key = selectionKey(rowId, languageCode);
  const live = readEditorTextSelection(doc);
  if (live) return selectionKey(live.rowId, live.languageCode) === key ? live : null;
  const focusedButton = doc?.activeElement?.closest?.(BUTTON_SELECTOR);
  return focusedButton && lastSelection && selectionKey(lastSelection.rowId, lastSelection.languageCode) === key
    ? lastSelection
    : null;
}

/** Enable the button of the panel holding the highlight; grey out the rest. */
export function syncEditorGlossaryEntryButtons(doc = globalThis.document) {
  if (!doc) return;
  const live = readEditorTextSelection(doc);
  if (live) lastSelection = live;
  const keepLast = !live && Boolean(doc.activeElement?.closest?.(BUTTON_SELECTOR));
  if (!live && !keepLast) lastSelection = null;
  const nextKey = live ? selectionKey(live.rowId, live.languageCode) : keepLast ? enabledKey : "";
  enabledKey = nextKey;
  for (const button of doc.querySelectorAll(BUTTON_SELECTOR)) {
    const enabled = Boolean(nextKey) && selectionKey(button.dataset.rowId, button.dataset.languageCode) === nextKey;
    if (button.getAttribute("aria-disabled") !== String(!enabled)) {
      button.setAttribute("aria-disabled", String(!enabled));
      button.classList.toggle("is-disabled", !enabled);
    }
  }
}

function comparableLanguageCode(code) {
  return String(code ?? "").trim().replaceAll("_", "-").toLowerCase();
}

function languageMatches(language, code) {
  const wanted = comparableLanguageCode(code);
  return Boolean(wanted) && [language?.code, language?.baseCode]
    .some((candidate) => comparableLanguageCode(candidate) === wanted);
}

/**
 * The chapter glossary's languages, from the loaded glossary or else from its
 * glossary-list record; the source falls back to the chapter's own.
 */
export function editorGlossaryEntryLanguages(editorChapter, glossaryRecord = null, chapterSourceCode = "") {
  const loaded = editorChapter?.glossary ?? {};
  return {
    sourceCode: loaded.sourceLanguage?.code ?? glossaryRecord?.sourceLanguage?.code ?? chapterSourceCode ?? "",
    targetCode: loaded.targetLanguage?.code ?? glossaryRecord?.targetLanguage?.code ?? "",
  };
}

/**
 * How a chapter language relates to the glossary: "source", "target" or
 * "other"; null when the glossary's languages are not known.
 */
export function glossaryEntryLanguageRole(language, { sourceCode = "", targetCode = "" } = {}) {
  if (languageMatches(language, sourceCode)) return "source";
  if (!targetCode) return null;
  return languageMatches(language, targetCode) ? "target" : "other";
}

export function glossaryEntryTooltip(role) {
  return role === "other" ? GLOSSARY_ENTRY_OTHER_LANGUAGE_TOOLTIP : GLOSSARY_ENTRY_TOOLTIP;
}
