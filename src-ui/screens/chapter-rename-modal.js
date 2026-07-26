import { escapeHtml, loadingPrimaryButton, secondaryButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";

export function renderChapterRenameModal(state) {
  const rename = state.chapterRename;
  if (!rename?.isOpen) {
    return "";
  }

  const isSubmitting = rename.status === "loading";
  const errorMarkup = rename.error
    ? `<p class="modal__error">${escapeHtml(formatErrorForDisplay(rename.error))}</p>`
    : "";
  const submitButton = loadingPrimaryButton({
    label: "Rename File",
    loadingLabel: "Saving...",
    action: "submit-chapter-rename",
    isLoading: isSubmitting,
    modalDefault: true,
  });
  const cancelButton = secondaryButton("Cancel", "cancel-chapter-rename", {
    disabled: isSubmitting,
    modalCancel: true,
  });

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact" role="dialog" aria-modal="true" aria-labelledby="chapter-rename-modal-title" data-modal-dialog="chapter-rename" tabindex="-1">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">RENAME FILE</p>
          <h2 class="modal__title" id="chapter-rename-modal-title">Rename This File</h2>
          <div class="modal__form">
            <label class="field">
              <span class="field__label">File Name</span>
              <input
                class="field__input"
                type="text"
                placeholder="Enter file name"
                value="${escapeHtml(rename.chapterName)}"
                data-chapter-rename-input
                data-modal-initial-focus
                ${isSubmitting ? "disabled" : ""}
              />
            </label>
          </div>
          ${errorMarkup}
          <div class="modal__actions">
            ${cancelButton}
            ${submitButton}
          </div>
        </div>
      </section>
    </div>
  `;
}
