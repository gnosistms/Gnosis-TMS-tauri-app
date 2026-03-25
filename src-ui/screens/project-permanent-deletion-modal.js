import { escapeHtml, loadingPrimaryButton, secondaryButton } from "../lib/ui.js";

export function renderProjectPermanentDeletionModal(state) {
  const deletion = state.projectPermanentDeletion;
  if (!deletion?.isOpen) {
    return "";
  }

  const isDeleting = deletion.status === "loading";
  const matchesName = deletion.confirmationText === deletion.projectName;
  const errorMarkup = deletion.error
    ? `<p class="modal__error">${escapeHtml(deletion.error)}</p>`
    : "";
  const deleteButton = isDeleting
    ? loadingPrimaryButton({
        label: "Delete",
        loadingLabel: "Deleting...",
        action: "confirm-project-permanent-deletion",
        isLoading: true,
      })
    : `<button class="button button--primary" data-action="confirm-project-permanent-deletion" data-project-permanent-delete-button ${
        matchesName ? "" : "disabled"
      }>Delete</button>`;
  const cancelButton = secondaryButton("Cancel", "cancel-project-permanent-deletion", {
    disabled: isDeleting,
  });

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">PERMANENT DELETE</p>
          <h2 class="modal__title">Permanently Delete Project?</h2>
          <p class="modal__supporting">
            To permanently delete this project, type <strong>${escapeHtml(
              deletion.projectName,
            )}</strong> in the text box below. Then click Delete. This action can not be undone.
          </p>
          <div class="modal__form">
            <label class="field">
              <span class="field__label">Project Name</span>
              <input
                class="field__input"
                type="text"
                placeholder="Enter project name here to delete"
                value="${escapeHtml(deletion.confirmationText)}"
                data-project-permanent-delete-input
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
