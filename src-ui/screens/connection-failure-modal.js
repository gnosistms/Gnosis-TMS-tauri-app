import { escapeHtml, primaryButton, secondaryButton } from "../lib/ui.js";

export function renderConnectionFailureModal(state) {
  const failure = state.connectionFailure;
  if (!failure?.isOpen) {
    return "";
  }
  const isReconnecting = failure.reconnecting === true;
  const reconnectButton = isReconnecting
    ? `
      <button class="button button--secondary button--loading" data-action="noop" disabled aria-busy="true">
        <span class="button__spinner" aria-hidden="true"></span>
        <span>Reconnect</span>
      </button>
    `
    : secondaryButton("Reconnect", "reconnect-from-connection-failure");

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
            ${reconnectButton}
            ${primaryButton("Go offline", "go-offline-from-connection-failure", {
              disabled: failure.canGoOffline !== true || isReconnecting,
            })}
          </div>
        </div>
      </section>
    </div>
  `;
}
