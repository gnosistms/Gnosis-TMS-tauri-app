import { escapeHtml } from "../lib/ui.js";
import { normalizeEditorFieldImage } from "./editor-images.js";
import { findEditorRowById } from "./editor-utils.js";
import { state } from "./state.js";

const MENU_SELECTOR = "[data-editor-image-context-menu-popover]";
const menuInvokers = new WeakMap();

function languageDisplayName(language) {
  return String(language?.name ?? "").trim() || String(language?.code ?? "").trim();
}

export function dismissEditorImageContextMenu(root = document, { restoreFocus = false } = {}) {
  root?.querySelector?.(MENU_SELECTOR)?.remove();
  const invoker = menuInvokers.get(root);
  menuInvokers.delete(root);
  if (restoreFocus && invoker?.isConnected) {
    invoker.focus?.({ preventScroll: true });
  }
}

export function renderEditorImageContextMenuItems(rowId, sourceLanguageCode) {
  const row = findEditorRowById(rowId, state.editorChapter);
  const sourceImage = normalizeEditorFieldImage(row?.images?.[sourceLanguageCode]);
  if (!row || !sourceImage) {
    return "";
  }

  const items = [];
  if (sourceImage.kind === "url" && sourceImage.url) {
    items.push(`
      <button
        class="editor-image-context-menu__item"
        type="button"
        role="menuitem"
        tabindex="-1"
        data-action="copy-editor-image-url"
        data-image-url="${escapeHtml(sourceImage.url)}"
      >Copy image URL</button>
    `);
  }

  const languages = Array.isArray(state.editorChapter?.languages)
    ? state.editorChapter.languages
    : [];
  for (const language of languages) {
    const destinationLanguageCode = String(language?.code ?? "").trim();
    if (!destinationLanguageCode || destinationLanguageCode === sourceLanguageCode) {
      continue;
    }
    items.push(`
      <button
        class="editor-image-context-menu__item"
        type="button"
        role="menuitem"
        tabindex="-1"
        data-action="duplicate-editor-language-image"
        data-row-id="${escapeHtml(rowId)}"
        data-source-language-code="${escapeHtml(sourceLanguageCode)}"
        data-destination-language-code="${escapeHtml(destinationLanguageCode)}"
      >Duplicate to ${escapeHtml(languageDisplayName(language))}</button>
    `);
  }

  return items.join("");
}

export function openEditorImageContextMenu(root, event, target) {
  const rowId = target?.dataset?.rowId ?? "";
  const sourceLanguageCode = target?.dataset?.languageCode ?? "";
  const items = renderEditorImageContextMenuItems(rowId, sourceLanguageCode);
  dismissEditorImageContextMenu(root);
  if (!items || !(root instanceof HTMLElement)) {
    return false;
  }

  root.insertAdjacentHTML(
    "beforeend",
    `<div class="editor-image-context-menu" role="menu" data-editor-image-context-menu-popover>${items}</div>`,
  );
  menuInvokers.set(root, target.closest?.("button") ?? target);
  const menu = root.querySelector(MENU_SELECTOR);
  if (!(menu instanceof HTMLElement)) {
    return false;
  }

  const viewportWidth = Math.max(0, document.documentElement?.clientWidth ?? window.innerWidth ?? 0);
  const viewportHeight = Math.max(0, document.documentElement?.clientHeight ?? window.innerHeight ?? 0);
  const margin = 8;
  const rect = menu.getBoundingClientRect();
  const left = Math.max(margin, Math.min(event.clientX, viewportWidth - rect.width - margin));
  const top = Math.max(margin, Math.min(event.clientY, viewportHeight - rect.height - margin));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.querySelector("button")?.focus({ preventScroll: true });
  return true;
}

export function handleEditorImageContextMenuKeydown(root, event) {
  const menu = event.target?.closest?.(MENU_SELECTOR);
  if (!(menu instanceof HTMLElement) || !root?.contains?.(menu)) {
    return false;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    dismissEditorImageContextMenu(root, { restoreFocus: true });
    return true;
  }
  if (event.key === "Tab") {
    dismissEditorImageContextMenu(root);
    return false;
  }
  const items = [...menu.querySelectorAll('[role="menuitem"]')]
    .filter((item) => item instanceof HTMLButtonElement && !item.disabled);
  if (items.length === 0) {
    return false;
  }
  const currentIndex = items.indexOf(event.target);
  let nextIndex = null;
  if (event.key === "ArrowDown") {
    nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
  } else if (event.key === "ArrowUp") {
    nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
  } else if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = items.length - 1;
  } else {
    return false;
  }
  if (nextIndex === null || nextIndex < 0 || items.length === 0) {
    return false;
  }
  event.preventDefault();
  items[nextIndex]?.focus({ preventScroll: true });
  return true;
}

export function handleEditorImageContextMenuInvocationKeydown(
  root,
  event,
  openMenu = openEditorImageContextMenu,
) {
  const isInvocationKey =
    event?.key === "ContextMenu"
    || (event?.key === "F10" && event?.shiftKey === true);
  if (!isInvocationKey) {
    return false;
  }
  const target = event.target?.closest?.("[data-editor-image-context-menu-target]");
  if (!(target instanceof HTMLElement) || !root?.contains?.(target)) {
    return false;
  }

  const rect = target.getBoundingClientRect();
  const opened = openMenu(
    root,
    {
      clientX: rect.left + Math.min(12, Math.max(0, rect.width)),
      clientY: rect.top + Math.min(12, Math.max(0, rect.height)),
    },
    target,
  );
  if (!opened) {
    return false;
  }
  event.preventDefault();
  event.stopPropagation();
  return true;
}
