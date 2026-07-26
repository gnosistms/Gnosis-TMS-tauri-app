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
    modalCancel: true,
    modalInitialFocus: true,
  });
  const deleteButton = loadingPrimaryButton({
    label: "Delete",
    loadingLabel: "Deleting...",
    action: "confirm-editor-row-permanent-delete",
    isLoading: isDeleting,
  });

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact" role="dialog" aria-modal="true" aria-labelledby="editor-row-permanent-deletion-modal-title" data-modal-dialog="editor-row-permanent-deletion" tabindex="-1">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">PERMANENT DELETE</p>
          <h2 class="modal__title" id="editor-row-permanent-deletion-modal-title">Permanently delete row?</h2>
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
