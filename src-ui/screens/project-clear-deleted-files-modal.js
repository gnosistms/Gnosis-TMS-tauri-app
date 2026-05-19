import { escapeHtml, loadingPrimaryButton, secondaryButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import { normalizedConfirmationValue } from "../app/resource-entity-modal.js";

export function renderProjectClearDeletedFilesModal(state) {
  const modal = state.projectClearDeletedFiles;
  if (!modal?.isOpen) {
    return "";
  }

  const isDeleting = modal.status === "loading";
  const matchesName =
    normalizedConfirmationValue(modal.confirmationText) === normalizedConfirmationValue(modal.projectName);
  const errorMarkup = modal.error
    ? `<p class="modal__error">${escapeHtml(formatErrorForDisplay(modal.error))}</p>`
    : "";
  const deleteButton = isDeleting
    ? loadingPrimaryButton({
        label: "Delete all",
        loadingLabel: "Deleting...",
        action: "confirm-clear-deleted-files",
        isLoading: true,
      })
    : `<button class="button button--primary" data-action="confirm-clear-deleted-files" data-project-clear-deleted-files-button ${
        matchesName ? "" : "disabled"
      }>Delete all</button>`;
  const cancelButton = secondaryButton("Cancel", "cancel-clear-deleted-files", {
    disabled: isDeleting,
  });

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">CLEAR DELETED FILES</p>
          <h2 class="modal__title">Permanently remove all deleted files</h2>
          <p class="modal__supporting">
            To permanently remove all deleted files in this project, type the project name:
            <strong>${escapeHtml(modal.projectName)}</strong> in the box below and click Delete all.
            This action cannot be undone.
          </p>
          <div class="modal__form">
            <label class="field">
              <span class="field__label">Project Name</span>
              <input
                class="field__input"
                type="text"
                placeholder="Enter project name here to delete all"
                value="${escapeHtml(modal.confirmationText)}"
                data-project-clear-deleted-files-input
                ${isDeleting ? "disabled" : ""}
              />
            </label>
          </div>
          ${errorMarkup}
          <div class="modal__actions">
            ${cancelButton}
            ${deleteButton}
          </div>
        </div>
      </section>
    </div>
  `;
}
