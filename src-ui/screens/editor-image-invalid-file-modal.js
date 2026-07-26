import { primaryButton } from "../lib/ui.js";

export function renderEditorImageInvalidFileModal(state) {
  const modal = state.editorChapter?.imageInvalidFileModal;
  if (!modal?.isOpen) {
    return "";
  }

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact" role="dialog" aria-modal="true" aria-labelledby="editor-image-invalid-file-modal-title" data-modal-dialog="editor-image-invalid-file" tabindex="-1">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">Invalid file</p>
          <h2 class="modal__title" id="editor-image-invalid-file-modal-title">The file you uploaded is not a valid image or could not be opened.</h2>
          <div class="modal__actions">
            ${primaryButton("Ok", "close-editor-image-invalid-file-modal", {
              modalDefault: true,
              modalCancel: true,
              modalInitialFocus: true,
            })}
          </div>
        </div>
      </section>
    </div>
  `;
}
