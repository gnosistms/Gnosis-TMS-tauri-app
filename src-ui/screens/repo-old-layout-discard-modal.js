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

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="eyebrow">SERVER HAS NEW DATA FORMAT</p>
          <h2 class="modal__title">Overwrite local changes</h2>
          <p class="modal__supporting">
            The data on the server has migrated to a new data format. You have changes saved on your computer in the old data format. In order to sync with the server, you must discard the changes on your computer.
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
