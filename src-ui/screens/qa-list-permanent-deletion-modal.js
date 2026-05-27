import { escapeHtml, loadingPrimaryButton, secondaryButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import { normalizedConfirmationValue } from "../app/resource-entity-modal.js";

export function renderQaListPermanentDeletionModal(state) {
  const deletion = state.qaListPermanentDeletion;
  if (!deletion?.isOpen) {
    return "";
  }

  const isDeleting = deletion.status === "loading";
  const matchesName =
    normalizedConfirmationValue(deletion.confirmationText) === normalizedConfirmationValue(deletion.qaListName);
  const errorMarkup = deletion.error
    ? `<p class="modal__error">${escapeHtml(formatErrorForDisplay(deletion.error))}</p>`
    : "";

  const deleteButton = isDeleting
    ? loadingPrimaryButton({
        label: "Delete",
        loadingLabel: "Deleting...",
        action: "confirm-qa-list-permanent-deletion",
        isLoading: true,
      })
    : `<button class="button button--primary" data-action="confirm-qa-list-permanent-deletion" data-qa-list-permanent-delete-button ${
        matchesName ? "" : "disabled"
      }>Delete</button>`;
  const cancelButton = secondaryButton("Cancel", "cancel-qa-list-permanent-deletion", {
    disabled: isDeleting,
  });

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">LOCAL DELETE</p>
          <h2 class="modal__title">Remove Local QA List Copy?</h2>
          <p class="modal__supporting">
            This removes the local copy from this computer only. It will not delete anything from GitHub or other team members' computers. To remove it, type <strong>${escapeHtml(
              deletion.qaListName,
            )}</strong> in the text box below. Then click Delete.
          </p>
          <div class="modal__form">
            <label class="field">
              <span class="field__label">QA List Name</span>
              <input
                class="field__input"
                type="text"
                placeholder="Enter QA list name here to remove"
                value="${escapeHtml(deletion.confirmationText)}"
                data-qa-list-permanent-delete-input
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
