import {
  errorButton,
  escapeHtml,
  secondaryButton,
} from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";

export function renderRepoOldLayoutDiscardModal({
  modal,
  resourceLabel,
  closeAction,
  confirmAction,
}) {
  if (modal?.isOpen !== true) {
    return "";
  }

  const isLoading = modal.status === "loading";
  const errorMarkup = modal.error
    ? `<p class="modal__error">${escapeHtml(formatErrorForDisplay(modal.error))}</p>`
    : "";
  const resourceCopyLabel = resourceLabel === "QA list"
    ? "QA list"
    : String(resourceLabel ?? "item").trim().toLowerCase() || "item";

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="eyebrow">SYNC UPDATE</p>
          <h2 class="modal__title">Overwrite local changes</h2>
          <p class="modal__supporting">
            A newer version of this ${escapeHtml(resourceCopyLabel)} is available online. To continue syncing, discard the unsynced changes saved on this computer.
          </p>
          ${modal.resourceName ? `<p class="modal__supporting">${escapeHtml(resourceLabel)}: ${escapeHtml(modal.resourceName)}</p>` : ""}
          ${errorMarkup}
          <div class="modal__actions">
            ${secondaryButton("Cancel", closeAction, { disabled: isLoading })}
            ${
              isLoading
                ? '<button class="button button--error button--loading" data-action="noop" disabled><span class="button__spinner" aria-hidden="true"></span><span>Discarding...</span></button>'
                : errorButton("Discard my changes and continue", confirmAction)
            }
          </div>
        </div>
      </section>
    </div>
  `;
}
