import {
  escapeHtml,
  loadingButton,
  primaryButton,
} from "../lib/ui.js";

export function renderConnectionFailureModal(state) {
  const failure = state.connectionFailure;
  if (!failure?.isOpen) {
    return "";
  }
  const isReconnecting = failure.reconnecting === true;
  const reconnectButton = loadingButton({
    label: "Reconnect",
    loadingLabel: "Reconnect",
    action: "reconnect-from-connection-failure",
    isLoading: isReconnecting,
    variant: "secondary",
  });

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact" role="dialog" aria-modal="true" aria-labelledby="connection-failure-modal-title" data-modal-dialog="connection-failure" tabindex="-1">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">CONNECTION ERROR</p>
          <h2 class="modal__title" id="connection-failure-modal-title">Connection unavailable</h2>
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
              modalDefault: true,
            })}
          </div>
        </div>
      </section>
    </div>
  `;
}
