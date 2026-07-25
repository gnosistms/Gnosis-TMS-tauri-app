import {
  escapeHtml,
  loadingButton,
  secondaryButton,
} from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";

export function renderProjectOldLayoutDiscardModal(state) {
  const modal = state.projectOldLayoutDiscard ?? {};
  if (modal.isOpen !== true) {
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
          <p class="eyebrow">SYNC UPDATE</p>
          <h2 class="modal__title">Overwrite local changes</h2>
          <p class="modal__supporting">
            A newer version of this project is available online. To continue syncing, discard the unsynced changes saved on this computer.
          </p>
          ${modal.resourceName ? `<p class="modal__supporting">Project: ${escapeHtml(modal.resourceName)}</p>` : ""}
          ${errorMarkup}
          <div class="modal__actions">
            ${secondaryButton("Cancel", "close-project-old-layout-discard", { disabled: isLoading })}
            ${loadingButton({
              label: "Discard my changes and continue",
              loadingLabel: "Discarding...",
              action: "confirm-project-old-layout-discard",
              isLoading,
              variant: "error",
            })}
          </div>
        </div>
      </section>
    </div>
  `;
}
