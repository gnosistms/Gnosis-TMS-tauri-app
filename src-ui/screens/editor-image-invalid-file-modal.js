import { primaryButton } from "../lib/ui.js";

export function renderEditorImageInvalidFileModal(state) {
  const modal = state.editorChapter?.imageInvalidFileModal;
  if (!modal?.isOpen) {
    return "";
  }

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">Invalid file</p>
          <h2 class="modal__title">The file you uploaded is not a valid image or could not be opened.</h2>
          <div class="modal__actions">
            ${primaryButton("Ok", "close-editor-image-invalid-file-modal")}
          </div>
        </div>
      </section>
    </div>
  `;
}
