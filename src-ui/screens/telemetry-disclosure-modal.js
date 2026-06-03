import { escapeHtml, primaryButton, secondaryButton } from "../lib/ui.js";

export function renderTelemetryDisclosureModal(state) {
  if (state.telemetryDisclosureModal?.isOpen !== true) {
    return "";
  }

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact" role="dialog" aria-modal="true" aria-labelledby="telemetry-disclosure-title">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">${escapeHtml("Error logging")}</p>
          <h2 class="modal__title" id="telemetry-disclosure-title">Send error reports to Gnosis TMS developers</h2>
          <p class="modal__supporting">
            If your app has errors, the development team would like to know so they can fix them. To allow sending error reports, click Allow error reports.
          </p>
          <div class="modal__actions">
            ${secondaryButton("Don't allow", "deny-error-reports")}
            ${primaryButton("Allow error reports", "allow-error-reports")}
          </div>
        </div>
      </section>
    </div>
  `;
}
