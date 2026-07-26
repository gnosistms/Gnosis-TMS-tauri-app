import { escapeHtml, loadingPrimaryButton, secondaryButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";

export function renderEditorUnreviewAllModal(state) {
  const modal = state.editorChapter?.unreviewAllModal;
  if (!modal?.isOpen) {
    return "";
  }

  const isSubmitting = modal.status === "loading";
  const errorMarkup = modal.error
    ? `<p class="modal__error">${escapeHtml(formatErrorForDisplay(modal.error))}</p>`
    : "";
  const cancelButton = secondaryButton("Cancel", "cancel-editor-unreview-all", {
    disabled: isSubmitting,
    modalCancel: true,
  });
  const confirmButton = loadingPrimaryButton({
    label: "Mark all unreviewed",
    loadingLabel: "Marking...",
    action: "confirm-editor-unreview-all",
    isLoading: isSubmitting,
    modalDefault: true,
  });

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact" role="dialog" aria-modal="true" aria-labelledby="editor-unreview-all-modal-title" data-modal-dialog="editor-unreview-all" tabindex="-1">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">UNREVIEW ALL</p>
          <h2 class="modal__title" id="editor-unreview-all-modal-title">Are you sure?</h2>
          <p class="modal__supporting">This will turn off the &quot;reviewed&quot; marker on every translation in the target language. This action can not be undone.</p>
          ${errorMarkup}
          <div class="modal__actions">
            ${cancelButton}
            ${confirmButton}
          </div>
        </div>
      </section>
    </div>
  `;
}
