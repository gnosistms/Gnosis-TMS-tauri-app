import { bookItemTitle } from "./project-book-model.js";
import { renderBookTitleProof, renderSelectedBookPage } from "../screens/project-book-composer.js";

// Preview reads and chapter selection must leave the scrolling chapter list and
// its focused input connected. Restoring focus after a modal rebuild is too late:
// the old list's scroll position and the native input interaction are already gone.
export function renderProjectBookPreview(root, state) {
  const modal = state.editorChapter?.exportModal;
  const list = root.querySelector(".book-composer__list");
  const scroll = root.querySelector(".book-composer__page-scroll");
  if (!modal?.isOpen || modal.page !== 1 || !modal.book || modal.error || !list || !scroll) return false;
  const items = new Map(modal.book.items.map((item) => [item.id, item]));
  for (const row of list.querySelectorAll("[data-book-item]")) {
    row.classList.toggle("is-selected", row.dataset.bookItem === modal.book.selectedItemId);
  }
  for (const input of list.querySelectorAll("[data-book-chapter-title]")) {
    const item = items.get(input.dataset.bookChapterTitle);
    if (!item) continue;
    const value = item.title ?? bookItemTitle(item);
    if (input.value !== value) input.value = value;
    input.placeholder = item.defaultTitle || item.name;
    input.closest("[data-book-item]")?.querySelector("[data-book-drag-handle]")
      ?.setAttribute("aria-label", `Reorder ${bookItemTitle(item)}`);
  }
  const selected = items.get(modal.book.selectedItemId);
  if (selected?.kind === "chapter") {
    const template = root.ownerDocument.createElement("template");
    template.innerHTML = renderSelectedBookPage(modal);
    if (scroll.innerHTML !== template.innerHTML) scroll.replaceChildren(template.content);
    root.querySelector(".book-copyright__toolbar, .book-contents__options")?.remove();
  } else if (selected?.kind === "title") {
    const current = scroll.querySelector("[data-book-title-proof]");
    if (current) {
      const template = root.ownerDocument.createElement("template");
      template.innerHTML = renderBookTitleProof(modal);
      const next = template.content.firstElementChild;
      if (current.outerHTML !== next.outerHTML) current.replaceWith(next);
    }
  } else if (selected?.kind === "contents") {
    // Background default-title discovery updates the contents without replacing
    // the title field the user may currently be editing above it.
    const template = root.ownerDocument.createElement("template");
    template.innerHTML = renderSelectedBookPage(modal);
    const contents = template.content.querySelector(".book-contents");
    const current = scroll.querySelector(".book-contents");
    if (current && contents && current.innerHTML !== contents.innerHTML) current.replaceWith(contents);
  }
  return true;
}
