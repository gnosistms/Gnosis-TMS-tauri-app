import { escapeHtml, loadingPrimaryButton, secondaryButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";

export function renderEditorRowPermanentDeletionModal(state) {
  const modal = state.editorChapter?.rowPermanentDeletionModal;
  if (!modal?.isOpen) {
    return "";
  }

  const isDeleting = modal.status === "loading";
  const errorMarkup = modal.error
    ? `<p class="modal__error">${escapeHtml(formatErrorForDisplay(modal.error))}</p>`
    : "";
  const cancelButton = secondaryButton("Cancel", "cancel-editor-row-permanent-delete", {
    disabled: isDeleting,
  });
  const deleteButton = loadingPrimaryButton({
    label: "Delete",
    loadingLabel: "Deleting...",
    action: "confirm-editor-row-permanent-delete",
    isLoading: isDeleting,
  });

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">PERMANENT DELETE</p>
          <h2 class="modal__title">Permanently delete row?</h2>
          <p class="modal__supporting">To permanently delete this row, click Delete. This action cannot be undone.</p>
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
