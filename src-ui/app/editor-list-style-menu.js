import { escapeHtml } from "../lib/ui.js";
import {
  EDITOR_ROW_LIST_STYLE_OPTIONS,
  normalizeEditorRowTextStyle,
} from "./editor-row-text-style.js";

// The list style menu of a list row's settings button. Its options use the
// style buttons' action, and like them they keep focus in an open field.
const MENU_SELECTOR = "[data-editor-list-style-menu]";
let activeInvoker = null;

export function dismissEditorListStyleMenu(root = document, { restoreFocus = false } = {}) {
  root?.querySelector?.(MENU_SELECTOR)?.remove();
  const invoker = activeInvoker;
  activeInvoker = null;
  if (!invoker) {
    return;
  }
  invoker.setAttribute("aria-expanded", "false");
  invoker.parentElement?.setAttribute("data-tooltip", "List style");
  if (restoreFocus && invoker.isConnected) {
    invoker.focus({ preventScroll: true });
  }
}

export function renderEditorListStyleMenuItems(rowId, textStyle) {
  const selectedTextStyle = normalizeEditorRowTextStyle(textStyle);
  return EDITOR_ROW_LIST_STYLE_OPTIONS.map((option) => `
    <button
      class="editor-image-context-menu__item editor-list-style-menu__item"
      type="button"
      role="menuitemradio"
      tabindex="-1"
      aria-checked="${option.value === selectedTextStyle ? "true" : "false"}"
      data-action="set-editor-row-text-style"
      data-editor-list-style-option
      data-row-id="${escapeHtml(rowId)}"
      data-text-style="${escapeHtml(option.value)}"
    ><span class="editor-list-style-menu__marker" aria-hidden="true">${escapeHtml(option.marker)}</span>${escapeHtml(option.label)}</button>
  `).join("");
}

// A second press on the open menu's button closes it. `focusMenu` is for
// keyboard presses; a mouse press leaves focus where it was.
export function toggleEditorListStyleMenu(root, button, { focusMenu = false } = {}) {
  const wasOpen = activeInvoker === button && root?.querySelector?.(MENU_SELECTOR);
  dismissEditorListStyleMenu(root);
  if (wasOpen || !(root instanceof HTMLElement) || !(button instanceof HTMLElement)) {
    return false;
  }

  root.insertAdjacentHTML(
    "beforeend",
    `<div class="editor-image-context-menu editor-list-style-menu" role="menu" aria-label="List style" data-editor-list-style-menu>${
      renderEditorListStyleMenuItems(button.dataset.rowId ?? "", button.dataset.textStyle ?? "")
    }</div>`,
  );
  const menu = root.querySelector(MENU_SELECTOR);
  if (!(menu instanceof HTMLElement)) {
    return false;
  }

  const viewportWidth = Math.max(0, document.documentElement?.clientWidth ?? window.innerWidth ?? 0);
  const viewportHeight = Math.max(0, document.documentElement?.clientHeight ?? window.innerHeight ?? 0);
  const margin = 8;
  const anchor = button.getBoundingClientRect();
  const rect = menu.getBoundingClientRect();
  const below = anchor.bottom + 4;
  const top = below + rect.height <= viewportHeight - margin ? below : anchor.top - rect.height - 4;
  menu.style.left = `${Math.max(margin, Math.min(anchor.right - rect.width, viewportWidth - rect.width - margin))}px`;
  menu.style.top = `${Math.max(margin, top)}px`;
  activeInvoker = button;
  button.setAttribute("aria-expanded", "true");
  button.parentElement?.removeAttribute("data-tooltip");
  if (focusMenu) {
    (menu.querySelector('[aria-checked="true"]') ?? menu.querySelector("button"))?.focus({ preventScroll: true });
  }
  return true;
}

export function editorListStyleMenuContains(target) {
  return Boolean(target?.closest?.(`${MENU_SELECTOR}, [data-editor-list-style-button]`));
}

export function handleEditorListStyleMenuKeydown(root, event) {
  const menu = root?.querySelector?.(MENU_SELECTOR);
  if (!(menu instanceof HTMLElement)) {
    return false;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    dismissEditorListStyleMenu(root, { restoreFocus: menu.contains(event.target) });
    return true;
  }
  if (!menu.contains(event.target)) {
    return false;
  }
  if (event.key === "Tab") {
    dismissEditorListStyleMenu(root, { restoreFocus: true });
    event.preventDefault();
    return true;
  }
  const items = [...menu.querySelectorAll("button")];
  const currentIndex = items.indexOf(event.target);
  const nextIndex = {
    ArrowDown: (currentIndex + 1) % items.length,
    ArrowUp: (currentIndex - 1 + items.length) % items.length,
    Home: 0,
    End: items.length - 1,
  }[event.key];
  if (nextIndex === undefined) {
    return false;
  }
  event.preventDefault();
  items[nextIndex]?.focus({ preventScroll: true });
  return true;
}
