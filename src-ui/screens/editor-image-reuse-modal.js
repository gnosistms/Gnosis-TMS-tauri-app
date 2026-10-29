import { escapeHtml, primaryButton, secondaryButton } from "../lib/ui.js";

function chapterTitleList(titles) {
  const names = (Array.isArray(titles) ? titles : [])
    .map((title) => String(title ?? "").trim())
    .filter(Boolean);
  return typeof Intl?.ListFormat === "function"
    ? new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(names)
    : names.join(", ");
}

export function renderEditorImageReuseModal(state) {
  const modal = state.editorChapter?.imageReuseModal;
  if (modal?.isOpen !== true) {
    return "";
  }

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact" role="dialog" aria-modal="true" aria-labelledby="editor-image-reuse-title" data-modal-dialog="editor-image-reuse" tabindex="-1">
        <div class="card__body modal-card__body">
          <h2 class="modal__title" id="editor-image-reuse-title">Duplicate image</h2>
          <p class="modal__supporting">
            This same image was also used in ${escapeHtml(chapterTitleList(modal.chapterTitles))}. Are you sure you want to use it again here?
          </p>
          <label class="field__checkbox">
            <input
              type="checkbox"
              data-editor-image-reuse-dont-show-again
              ${modal.dontShowAgain ? "checked" : ""}
            />
            <span>Don't show this warning again for this image.</span>
          </label>
          <div class="modal__actions">
            ${secondaryButton("Cancel", "cancel-editor-image-reuse", {
              modalCancel: true,
            })}
            ${primaryButton("Insert image", "confirm-editor-image-reuse", {
              modalDefault: true,
              modalInitialFocus: true,
            })}
          </div>
        </div>
      </section>
    </div>
  `;
}
