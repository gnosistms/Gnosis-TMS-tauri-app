import { bookItemIncluded, bookItemTitle } from "./project-book-model.js";
import { renderBookTitleProof, renderProjectBookItems, renderSelectedBookPage } from "../screens/project-book-composer.js";

function reconcileInclusion(list, modal) {
  const rows = new Map([...list.querySelectorAll("[data-book-item]")].map((row) => [row.dataset.bookItem, row]));
  const changed = modal.book.items.filter((item) => rows.get(item.id)?.dataset.bookIncluded !== String(bookItemIncluded(item)));
  if (!changed.length) return;
  const template = list.ownerDocument.createElement("template");
  template.innerHTML = renderProjectBookItems(modal);
  let focus;
  for (const item of changed) {
    const old = rows.get(item.id);
    if (old?.contains(list.ownerDocument.activeElement)) {
      const neighbor = old.nextElementSibling || old.previousElementSibling;
      focus = neighbor?.querySelector(".book-item__toggle:not(:disabled)") || list;
    }
    const group = bookItemIncluded(item) ? "included" : "excluded";
    const source = template.content.querySelector(`[data-book-list="${group}"]`);
    const replacement = [...source.children].find((row) => row.dataset.bookItem === item.id);
    const target = list.querySelector(`[data-book-list="${group}"]`);
    const following = [...source.children].slice([...source.children].indexOf(replacement) + 1)
      .map((row) => rows.get(row.dataset.bookItem)).find((row) => row?.parentElement === target);
    old?.remove();
    target.insertBefore(replacement, following || null);
    rows.set(item.id, replacement);
  }
  for (const group of ["included", "excluded"]) {
    list.querySelector(`[data-book-count="${group}"]`).textContent = template.content.querySelector(`[data-book-count="${group}"]`).textContent;
  }
  const empty = !modal.book.items.some(bookItemIncluded);
  list.querySelector("[data-book-empty-hint]").hidden = !empty;
  const excludedEmpty = !modal.book.items.some((item) => !bookItemIncluded(item));
  list.querySelector(".book-excluded-heading").hidden = excludedEmpty;
  list.querySelector('[data-book-list="excluded"]').hidden = excludedEmpty;
  list.closest('[data-modal-dialog="editor-export"]').querySelector('[data-action="book-next"]').disabled = empty;
  // The toggled row may now live far outside the viewport. Keyboard focus stays
  // with a surviving neighbor instead of scrolling to the row's new group.
  if (focus?.isConnected) focus.focus({ preventScroll: true });
}

// Preview reads and chapter selection must leave the scrolling chapter list and
// its focused input connected. Restoring focus after a modal rebuild is too late:
// the old list's scroll position and the native input interaction are already gone.
export function renderProjectBookPreview(root, state) {
  const modal = state.editorChapter?.exportModal;
  const list = root.querySelector(".book-composer__list");
  const scroll = root.querySelector(".book-composer__page-scroll");
  if (!modal?.isOpen || modal.page !== 1 || !modal.book || modal.error || !list || !scroll) return false;
  reconcileInclusion(list, modal);
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
