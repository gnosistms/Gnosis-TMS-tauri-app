import { escapeHtml, loadingPrimaryButton, secondaryButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";

export function renderEditorReplaceUndoModal(state) {
  const modal = state.editorChapter?.replaceUndoModal;
  if (!modal?.isOpen) {
    return "";
  }

  const isSubmitting = modal.status === "loading";
  const errorMarkup = modal.error
    ? `<p class="modal__error">${escapeHtml(formatErrorForDisplay(modal.error))}</p>`
    : "";
  const cancelButton = secondaryButton("Cancel", "cancel-editor-replace-undo", {
    disabled: isSubmitting,
  });
  const undoButton = loadingPrimaryButton({
    label: "Undo replace",
    loadingLabel: "Undoing...",
    action: "confirm-editor-replace-undo",
    isLoading: isSubmitting,
  });

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">UNDO</p>
          <h2 class="modal__title">Undo batch find and replace</h2>
          <p class="modal__supporting">You can undo the batch find and replace operation for all rows that have not been edited after the batch replace operation was completed. For any rows that have already been edited, you must find them and fix them one at a time.</p>
          ${errorMarkup}
          <div class="modal__actions">
            ${cancelButton}
            ${undoButton}
          </div>
        </div>
      </section>
    </div>
  `;
}
