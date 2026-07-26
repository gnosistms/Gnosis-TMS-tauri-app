import { escapeHtml } from "../lib/ui.js";

export function renderNavigationLoadingModal(state) {
  const modal = state.navigationLoadingModal;
  if (!modal?.isOpen) {
    return "";
  }

  const title = String(modal.title ?? "").trim() || "Loading...";
  const message = String(modal.message ?? "").trim();

  return `
    <div class="modal-backdrop modal-backdrop--navigation-loading" aria-live="polite">
      <section class="card modal-card modal-card--compact modal-card--navigation-loading" role="dialog" aria-modal="true" aria-labelledby="navigation-loading-modal-title" aria-busy="true" data-modal-dialog="navigation-loading" tabindex="-1">
        <div class="card__body modal-card__body modal-card__body--navigation-loading">
          <div class="navigation-loading-modal__spinner" aria-hidden="true"></div>
          <h2 class="modal__title navigation-loading-modal__title" id="navigation-loading-modal-title">${escapeHtml(title)}</h2>
          ${message ? `<p class="modal__supporting navigation-loading-modal__message">${escapeHtml(message)}</p>` : ""}
        </div>
      </section>
    </div>
  `;
}
