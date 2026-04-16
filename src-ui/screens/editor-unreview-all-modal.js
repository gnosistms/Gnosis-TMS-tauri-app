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
  });
  const confirmButton = loadingPrimaryButton({
    label: "Mark all unreviewed",
    loadingLabel: "Marking...",
    action: "confirm-editor-unreview-all",
    isLoading: isSubmitting,
  });

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">UNREVIEW ALL</p>
          <h2 class="modal__title">Are you sure?</h2>
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
