import { escapeHtml, loadingPrimaryButton, secondaryButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";

export function renderEditorRowInsertModal(state) {
  const modal = state.editorChapter?.insertRowModal;
  if (!modal?.isOpen) {
    return "";
  }

  const isSubmitting = modal.status === "loading";
  const errorMarkup = modal.error
    ? `<p class="modal__error">${escapeHtml(formatErrorForDisplay(modal.error))}</p>`
    : "";
  const cancelButton = secondaryButton("Cancel", "cancel-insert-editor-row", {
    disabled: isSubmitting,
  });
  const beforeButton = loadingPrimaryButton({
    label: "Before",
    loadingLabel: "Saving...",
    action: "confirm-insert-editor-row-before",
    isLoading: isSubmitting,
  });
  const afterButton = isSubmitting
    ? ""
    : `<button class="button button--primary" data-action="confirm-insert-editor-row-after">After</button>`;

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">INSERT NEW ROW</p>
          <h2 class="modal__title">Before or after?</h2>
          <p class="modal__supporting">Do you want to insert the new row before or after this row?</p>
          ${errorMarkup}
          <div class="modal__actions">
            ${cancelButton}
            ${beforeButton}
            ${afterButton}
          </div>
        </div>
      </section>
    </div>
  `;
}
