import { escapeHtml, loadingPrimaryButton, secondaryButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import { normalizedConfirmationValue } from "../app/resource-entity-modal.js";

export function renderChapterPermanentDeletionModal(state) {
  const deletion = state.chapterPermanentDeletion;
  if (!deletion?.isOpen) {
    return "";
  }

  const isDeleting = deletion.status === "loading";
  const matchesName =
    normalizedConfirmationValue(deletion.confirmationText) === normalizedConfirmationValue(deletion.chapterName);
  const errorMarkup = deletion.error
    ? `<p class="modal__error">${escapeHtml(formatErrorForDisplay(deletion.error))}</p>`
    : "";
  const deleteButton = isDeleting
    ? loadingPrimaryButton({
        label: "Delete",
        loadingLabel: "Deleting...",
        action: "confirm-chapter-permanent-deletion",
        isLoading: true,
      })
    : `<button class="button button--primary" data-action="confirm-chapter-permanent-deletion" data-chapter-permanent-delete-button ${
        matchesName ? "" : "disabled"
      }>Delete</button>`;
  const cancelButton = secondaryButton("Cancel", "cancel-chapter-permanent-deletion", {
    disabled: isDeleting,
  });

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">PERMANENT DELETE</p>
          <h2 class="modal__title">Permanently Delete File?</h2>
          <p class="modal__supporting">
            To permanently delete this file, type <strong>${escapeHtml(
              deletion.chapterName,
            )}</strong> in the text box below. Then click Delete. This action can not be undone.
          </p>
          <div class="modal__form">
            <label class="field">
              <span class="field__label">File Name</span>
              <input
                class="field__input"
                type="text"
                placeholder="Enter file name here to delete"
                value="${escapeHtml(deletion.confirmationText)}"
                data-chapter-permanent-delete-input
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
