import {
  escapeHtml,
  loadingPrimaryButton,
  secondaryButton,
} from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";

export function renderEditorImageDuplicateOverwriteModal(state) {
  const modal = state.editorChapter?.imageDuplicateOverwriteModal;
  if (modal?.isOpen !== true) {
    return "";
  }

  const languageName = String(modal.destinationLanguageName || modal.destinationLanguageCode || "")
    .trim();
  const isLoading = modal.status === "loading";
  const errorMarkup = modal.error
    ? `<p class="modal__error">${escapeHtml(formatErrorForDisplay(modal.error))}</p>`
    : "";

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact" role="dialog" aria-modal="true" aria-labelledby="editor-image-duplicate-overwrite-title">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">Duplicate image</p>
          <h2 class="modal__title" id="editor-image-duplicate-overwrite-title">Overwrite the ${escapeHtml(languageName)} image?</h2>
          <p class="modal__supporting">${escapeHtml(languageName)} already has an image. Do you want to overwrite it?</p>
          ${errorMarkup}
          <div class="modal__actions">
            ${secondaryButton("Cancel", "cancel-editor-image-duplicate-overwrite", {
              disabled: isLoading,
            })}
            ${loadingPrimaryButton({
              label: "Overwrite",
              loadingLabel: "Overwriting...",
              action: "confirm-editor-image-duplicate-overwrite",
              isLoading,
            })}
          </div>
        </div>
      </section>
    </div>
  `;
}
