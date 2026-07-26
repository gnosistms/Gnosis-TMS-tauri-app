import { escapeHtml, secondaryButton } from "../lib/ui.js";

export function renderEditorImageCaptionTranslationModal(state) {
  const modal = state.editorChapter?.imageCaptionTranslationModal;
  if (modal?.isOpen !== true) {
    return "";
  }

  const languageName = String(
    modal.destinationLanguageName || modal.destinationLanguageCode || "",
  ).trim();

  return `
    <div class="modal-backdrop modal-backdrop--navigation-loading" aria-live="polite">
      <section
        class="card modal-card modal-card--compact modal-card--navigation-loading"
        role="dialog"
        aria-modal="true"
        aria-busy="true"
        aria-labelledby="editor-image-caption-translation-title"
      >
        <div class="card__body modal-card__body modal-card__body--navigation-loading">
          <div class="navigation-loading-modal__spinner" aria-hidden="true"></div>
          <h2 class="modal__title navigation-loading-modal__title" id="editor-image-caption-translation-title">Translating caption</h2>
          <p class="modal__supporting navigation-loading-modal__message">Please wait while the image caption is translated${languageName ? ` into ${escapeHtml(languageName)}` : ""}.</p>
          <div class="modal__actions">
            ${secondaryButton("Cancel", "cancel-editor-image-caption-translation")}
          </div>
        </div>
      </section>
    </div>
  `;
}
