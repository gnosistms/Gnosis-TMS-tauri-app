import { escapeHtml, loadingPrimaryButton, secondaryButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";

export function renderGlossaryPermanentDeletionModal(state) {
  const deletion = state.glossaryPermanentDeletion;
  if (!deletion?.isOpen) {
    return "";
  }

  const isDeleting = deletion.status === "loading";
  const matchesName = deletion.confirmationText === deletion.glossaryName;
  const errorMarkup = deletion.error
    ? `<p class="modal__error">${escapeHtml(formatErrorForDisplay(deletion.error))}</p>`
    : "";
  const deleteButton = isDeleting
    ? loadingPrimaryButton({
        label: "Delete",
        loadingLabel: "Deleting...",
        action: "confirm-glossary-permanent-deletion",
        isLoading: true,
      })
    : `<button class="button button--primary" data-action="confirm-glossary-permanent-deletion" data-glossary-permanent-delete-button ${
        matchesName ? "" : "disabled"
      }>Delete</button>`;
  const cancelButton = secondaryButton("Cancel", "cancel-glossary-permanent-deletion", {
    disabled: isDeleting,
  });

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">PERMANENT DELETE</p>
          <h2 class="modal__title">Permanently Delete Glossary?</h2>
          <p class="modal__supporting">
            To permanently delete this glossary, type <strong>${escapeHtml(
              deletion.glossaryName,
            )}</strong> in the text box below. Then click Delete. This action can not be undone.
          </p>
          <div class="modal__form">
            <label class="field">
              <span class="field__label">Glossary Name</span>
              <input
                class="field__input"
                type="text"
                placeholder="Enter glossary name here to delete"
                value="${escapeHtml(deletion.confirmationText)}"
                data-glossary-permanent-delete-input
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
