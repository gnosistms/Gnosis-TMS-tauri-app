import {
  escapeHtml,
  loadingButton,
  secondaryButton,
} from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";

export function renderRepoOldLayoutDiscardModal({
  modal,
  resourceLabel,
  modalId,
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
      <section class="card modal-card modal-card--compact" role="dialog" aria-modal="true" aria-labelledby="${escapeHtml(modalId)}-title" data-modal-dialog="${escapeHtml(modalId)}" tabindex="-1">
        <div class="card__body modal-card__body">
          <p class="eyebrow">SYNC UPDATE</p>
          <h2 class="modal__title" id="${escapeHtml(modalId)}-title">Overwrite local changes</h2>
          <p class="modal__supporting">
            A newer version of this ${escapeHtml(resourceCopyLabel)} is available online. To continue syncing, discard the unsynced changes saved on this computer.
          </p>
          ${modal.resourceName ? `<p class="modal__supporting">${escapeHtml(resourceLabel)}: ${escapeHtml(modal.resourceName)}</p>` : ""}
          ${errorMarkup}
          <div class="modal__actions">
            ${secondaryButton("Cancel", closeAction, {
              disabled: isLoading,
              modalCancel: true,
              modalInitialFocus: true,
            })}
            ${loadingButton({
              label: "Discard my changes and continue",
              loadingLabel: "Discarding...",
              action: confirmAction,
              isLoading,
              variant: "error",
            })}
          </div>
        </div>
      </section>
    </div>
  `;
}
