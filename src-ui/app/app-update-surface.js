import { renderAppUpdatePill } from "../lib/ui.js";

// Update only the badge: download events must never remount an active editor.
export function renderAppUpdateSurface(root, update) {
  const existing = root.querySelector(".app-update-pill");
  const markup = renderAppUpdatePill(update);
  if (existing) {
    existing.outerHTML = markup;
    return;
  }
  if (!markup) return;
  let host = root.querySelector(".page-header__subtitle-row");
  if (!host) {
    const title = root.querySelector(".page-header__title-wrap");
    if (title) {
      title.insertAdjacentHTML("beforeend", '<div class="page-header__subtitle-row"></div>');
      host = title.querySelector(".page-header__subtitle-row");
    }
  }
  if (!host) {
    host = root.querySelector(".app-update-fallback");
    if (!host) {
      root.insertAdjacentHTML("beforeend", '<div class="app-update-fallback"></div>');
      host = root.querySelector(".app-update-fallback");
    }
  }
  host.insertAdjacentHTML("beforeend", markup);
}
