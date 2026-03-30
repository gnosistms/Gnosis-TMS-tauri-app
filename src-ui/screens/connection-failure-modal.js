import { escapeHtml, primaryButton, secondaryButton } from "../lib/ui.js";

export function renderConnectionFailureModal(state) {
  const failure = state.connectionFailure;
  if (!failure?.isOpen) {
    return "";
  }

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">CONNECTION ERROR</p>
          <h2 class="modal__title">Connection unavailable</h2>
          <p class="modal__supporting">
            ${escapeHtml(failure.message)}
          </p>
          <p class="modal__supporting">
            Would you like to go to offline mode?
          </p>
          <div class="modal__actions">
            ${secondaryButton("Cancel", "dismiss-connection-failure")}
            ${primaryButton("Go offline", "go-offline-from-connection-failure", {
              disabled: failure.canGoOffline !== true,
            })}
          </div>
        </div>
      </section>
    </div>
  `;
}
