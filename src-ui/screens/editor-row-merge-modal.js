import {
  escapeHtml,
  loadingButton,
  secondaryButton,
} from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import { adjacentActiveEditorRowIds } from "../app/editor-row-structure-state.js";

export function renderEditorRowMergeModal(state) {
  const modal = state.editorChapter?.mergeRowModal;
  if (!modal?.isOpen) {
    return "";
  }

  const isSubmitting = modal.status === "loading";
  const { previousRowId, nextRowId } = adjacentActiveEditorRowIds(
    state.editorChapter?.rows,
    modal.rowId,
  );
  const errorMarkup = modal.error
    ? `<p class="modal__error">${escapeHtml(formatErrorForDisplay(modal.error))}</p>`
    : "";
  const cancelButton = secondaryButton("Cancel", "cancel-merge-editor-rows", {
    disabled: isSubmitting,
    modalCancel: true,
    modalInitialFocus: true,
  });
  const directionButton = (label, action, isAvailable) => `
    <button
      class="button button--primary${isAvailable ? "" : " is-disabled"}"
      data-action="${escapeHtml(action)}"
      ${isAvailable ? "" : 'disabled aria-disabled="true"'}
    >${escapeHtml(label)}</button>
  `;
  const directionButtons = isSubmitting
    ? loadingButton({
      label: "Merge",
      loadingLabel: "Merging...",
      action: "merge-editor-rows",
      isLoading: true,
    })
    : directionButton("Previous", "confirm-merge-editor-rows-previous", Boolean(previousRowId))
      + directionButton("Next", "confirm-merge-editor-rows-next", Boolean(nextRowId));

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact" role="dialog" aria-modal="true" aria-labelledby="editor-row-merge-modal-title" data-modal-dialog="editor-row-merge" tabindex="-1">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">MERGE ROWS</p>
          <h2 class="modal__title" id="editor-row-merge-modal-title">Previous or next?</h2>
          <p class="modal__supporting">Do you want to merge this row with the previous row or the next row?</p>
          ${errorMarkup}
          <div class="modal__actions">
            ${cancelButton}
            ${directionButtons}
          </div>
        </div>
      </section>
    </div>
  `;
}
