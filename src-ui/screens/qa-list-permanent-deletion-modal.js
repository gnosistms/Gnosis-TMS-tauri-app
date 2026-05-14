import { escapeHtml, secondaryButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import { normalizedConfirmationValue } from "../app/resource-entity-modal.js";

export function renderQaListPermanentDeletionModal(state) {
  const deletion = state.qaListPermanentDeletion;
  if (!deletion?.isOpen) {
    return "";
  }

  const isSubmitting = deletion.status === "loading";
  const confirmationMatches =
    normalizedConfirmationValue(deletion.confirmationText) === normalizedConfirmationValue(deletion.qaListName);
  const errorMarkup = deletion.error
    ? `<p class="modal__error">${escapeHtml(formatErrorForDisplay(deletion.error))}</p>`
    : "";

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">DELETE QA LIST</p>
          <h2 class="modal__title">Permanently Delete This QA List</h2>
          <p class="modal__supporting">Type <strong>${escapeHtml(deletion.qaListName)}</strong> to confirm.</p>
          <div class="modal__form">
            <label class="field">
              <span class="field__label">QA List Name</span>
              <input
                class="field__input"
                type="text"
                value="${escapeHtml(deletion.confirmationText)}"
                data-qa-list-permanent-delete-input
                ${isSubmitting ? "disabled" : ""}
              />
            </label>
          </div>
          ${errorMarkup}
          <div class="modal__actions">
            ${secondaryButton("Cancel", "cancel-qa-list-permanent-deletion", { disabled: isSubmitting })}
            <button
              class="button button--primary${isSubmitting ? " button--loading" : ""}"
              data-action="${isSubmitting ? "noop" : "confirm-qa-list-permanent-deletion"}"
              data-qa-list-permanent-delete-button
              ${isSubmitting || !confirmationMatches ? "disabled aria-disabled=\"true\"" : ""}
            >
              ${isSubmitting ? '<span class="button__spinner" aria-hidden="true"></span><span>Deleting...</span>' : "<span>Delete QA List</span>"}
            </button>
          </div>
        </div>
      </section>
    </div>
  `;
}
