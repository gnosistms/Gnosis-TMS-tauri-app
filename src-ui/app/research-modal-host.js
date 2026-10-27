// The research windows live beside #app, not inside it. A full render
// rebuilds everything in #app (background sync, status updates…), which
// would rebuild an open research window too; here they are redrawn only when
// their own HTML changes, so the person's typing, selection and scroll
// position are left alone.

import { app } from "./runtime.js";
import { renderGlossaryResearchModal } from "../screens/glossary-research-modal.js";
import { renderEditorGlossaryEntryModal } from "../screens/editor-glossary-entry-modal.js";
import { captureFocusedInputState, restoreFocusedInputState } from "./focused-input-state.js";
import { captureModalRenderState, reconcileModalRenderState } from "./events/modal-dialog.js";
import { syncLanguagePickerAlphabetIndexes } from "./language-picker-alphabet-index.js";
import { syncResearchTextareaHeights } from "./glossary-research-flow.js";

// Parts of the research windows that scroll; their positions survive a redraw.
const SCROLLED_PARTS = [".modal-card", "[data-research-log]", ".language-picker-modal__list"];

let host = null;
let lastHtml = "";

function ensureHost() {
  if (!host) {
    host = document.createElement("div");
    host.id = "research-modal-host";
    app.after(host);
  }
  return host;
}

export function researchModalHostContains(element) {
  return Boolean(host && element && host.contains(element));
}

/** True while a research window is on screen. */
export function researchModalOpen() {
  return Boolean(host?.querySelector("[data-modal-dialog]"));
}

export function researchModalsHtml(state) {
  const onGlossary = state.screen === "glossaryEditor";
  return (onGlossary ? renderGlossaryResearchModal(state) : "")
    + (state.screen === "translate" ? renderEditorGlossaryEntryModal(state) : "");
}

/**
 * Typing updates state without a redraw; the window already shows the typed
 * text. Record that as the current drawing, so a redraw that follows (e.g.
 * on the box losing focus as a button is clicked) does not rebuild the window
 * under the click.
 */
export function noteResearchModalsTyped(state) {
  if (host) lastHtml = researchModalsHtml(state);
}

/** Redraw the research windows if, and only if, their HTML changed. */
export function renderResearchModals(state) {
  const html = researchModalsHtml(state);
  if (html === lastHtml) return false;
  const root = ensureHost();
  const focus = root.contains(document.activeElement) ? captureFocusedInputState() : null;
  const modal = captureModalRenderState(root);
  const scrolls = SCROLLED_PARTS.map((selector) => root.querySelector(selector)?.scrollTop ?? 0);
  root.innerHTML = html;
  lastHtml = html;
  // Scroll positions go back last, once boxes have their heights and focus
  // is restored, so nothing afterwards shortens the window under them.
  syncResearchTextareaHeights(root);
  syncLanguagePickerAlphabetIndexes(root);
  if (focus) restoreFocusedInputState(focus);
  reconcileModalRenderState(root, modal);
  SCROLLED_PARTS.forEach((selector, index) => {
    const element = root.querySelector(selector);
    if (element && scrolls[index]) element.scrollTop = scrolls[index];
  });
  return true;
}
