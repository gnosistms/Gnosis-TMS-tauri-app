import { escapeHtml, secondaryButton } from "../lib/ui.js";
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
  });
  const directionButton = (label, action, isAvailable) => `
    <button
      class="button button--primary${isAvailable ? "" : " is-disabled"}"
      data-action="${escapeHtml(action)}"
      ${isAvailable ? "" : 'disabled aria-disabled="true"'}
    >${escapeHtml(label)}</button>
  `;
  const directionButtons = isSubmitting
    ? `
      <button class="button button--primary button--loading" data-action="noop" disabled>
        <span class="button__spinner" aria-hidden="true"></span>
        <span>Merging...</span>
      </button>
    `
    : directionButton("Previous", "confirm-merge-editor-rows-previous", Boolean(previousRowId))
      + directionButton("Next", "confirm-merge-editor-rows-next", Boolean(nextRowId));

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">MERGE ROWS</p>
          <h2 class="modal__title">Previous or next?</h2>
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
