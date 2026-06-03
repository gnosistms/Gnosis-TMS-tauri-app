import { escapeHtml, primaryButton } from "../lib/ui.js";

export function renderTelemetryDisclosureModal(state) {
  const modal = state.telemetryDisclosureModal;
  if (modal?.isOpen !== true) {
    return "";
  }

  const checked = modal.enabled !== false ? "checked" : "";

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact" role="dialog" aria-modal="true" aria-labelledby="telemetry-disclosure-title">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">${escapeHtml("Error logging")}</p>
          <h2 class="modal__title" id="telemetry-disclosure-title">Send error reports to Gnosis TMS developers</h2>
          <p class="modal__supporting">
            If your app has errors, the development team would like to know so they can fix them.
          </p>
          <label class="telemetry-disclosure-modal__setting">
            <span class="telemetry-disclosure-modal__setting-label">Send error reports</span>
            <span class="telemetry-disclosure-modal__switch">
              <input
                type="checkbox"
                data-telemetry-disclosure-enabled-toggle
                ${checked}
              />
              <span class="telemetry-disclosure-modal__switch-track">
                <span class="telemetry-disclosure-modal__switch-thumb"></span>
              </span>
            </span>
          </label>
          <div class="modal__actions">
            ${primaryButton("Save", "save-error-reporting-settings")}
          </div>
        </div>
      </section>
    </div>
  `;
}
