import { escapeHtml } from "../lib/ui.js";
import { state } from "./state.js";
import { handleProjectBookAction } from "./project-book-flow.js";

let active;

export function dismissBookChapterMenu(restoreFocus = false) {
  if (!active) return;
  const { button, menu } = active;
  active = null;
  menu.remove();
  button.parentElement?.setAttribute("data-tooltip", "Settings");
  button.setAttribute("aria-expanded", "false");
  button.removeAttribute("aria-controls");
  if (restoreFocus && button.isConnected) button.focus({ preventScroll: true });
}

export function openBookChapterMenu(button) {
  const same = active?.button === button;
  dismissBookChapterMenu();
  if (same) return;
  const modal = state.editorChapter?.exportModal;
  const item = modal?.book?.items.find((item) => item.id === button.dataset.bookSettingsButton && item.kind === "chapter");
  const dialog = button.closest('[data-modal-dialog="editor-export"]');
  if (!item || !dialog || !modal.isOpen || modal.page !== 1 || modal.status !== "idle") return;
  const menu = document.createElement("div");
  menu.className = "editor-image-context-menu book-chapter-menu";
  menu.id = "book-chapter-settings-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Chapter settings");
  menu.setAttribute("data-book-chapter-menu", "");
  menu.setAttribute("data-stop-row-action", "");
  menu.innerHTML = `<button type="button" class="editor-image-context-menu__item" role="menuitemcheckbox" aria-checked="${item.numbered !== false}" tabindex="-1" data-book-numbered-item="${escapeHtml(item.id)}"><span class="book-chapter-menu__check" aria-hidden="true">${item.numbered !== false ? "✓" : ""}</span>Numbered</button>`;
  // Keep the menu within the dialog's focus scope, outside the clipped list.
  dialog.append(menu);
  const anchor = button.getBoundingClientRect(), bounds = dialog.getBoundingClientRect();
  const box = menu.getBoundingClientRect();
  const left = Math.max(bounds.left + 8, Math.min(anchor.right - box.width, bounds.right - box.width - 8));
  const below = anchor.bottom + 6;
  const top = Math.max(bounds.top + 8, Math.min(below + box.height <= bounds.bottom - 8 ? below : anchor.top - box.height - 6, bounds.bottom - box.height - 8));
  menu.style.left = `${left - bounds.left - dialog.clientLeft}px`;
  menu.style.top = `${top - bounds.top - dialog.clientTop}px`;
  button.setAttribute("aria-expanded", "true");
  button.parentElement?.removeAttribute("data-tooltip");
  button.setAttribute("aria-controls", menu.id);
  active = { button, menu };
  menu.querySelector("button").focus({ preventScroll: true });
}

export function handleBookChapterMenuClick(event, render) {
  const button = event.target.closest?.("[data-book-settings-button]");
  if (button) { openBookChapterMenu(button); return; }
  const option = event.target.closest?.("[data-book-numbered-item]");
  if (!option || !active?.menu.contains(option)) return;
  const id = option.dataset.bookNumberedItem;
  dismissBookChapterMenu(true);
  void handleProjectBookAction(`book-numbered:${id}`, render);
}

export function dismissBookChapterMenuOutside(target) {
  if (active && (!active.menu.isConnected || (!active.menu.contains(target) && !active.button.contains(target)))) dismissBookChapterMenu();
}

export function handleBookChapterMenuKeydown(event) {
  if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
  if (active && !active.menu.isConnected) dismissBookChapterMenu();
  const trigger = event.target.closest?.("[data-book-settings-button]");
  if (trigger && ["ArrowDown", "ArrowUp"].includes(event.key)) {
    event.preventDefault();
    if (active?.button === trigger) active.menu.querySelector("button").focus({ preventScroll: true });
    else openBookChapterMenu(trigger);
  } else if (active && event.key === "Escape") {
    event.preventDefault();
    dismissBookChapterMenu(true);
  } else if (active && event.key === "Tab") {
    dismissBookChapterMenu(true);
  } else if (active?.menu.contains(event.target) && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    active.menu.querySelector("button").focus({ preventScroll: true });
  }
}
