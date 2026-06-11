import { escapeHtml, primaryButton, secondaryButton } from "../lib/ui.js";
import { validateEditorLinkUrl } from "../app/editor-link-flow.js";

export function renderEditorInsertLinkModal(state) {
  const modal = state.editorChapter?.insertLinkModal;
  if (!modal?.isOpen) {
    return "";
  }

  if (modal.mode === "no-selection") {
    return `
      <div class="modal-backdrop">
        <section class="card modal-card modal-card--compact modal-card--insert-link">
          <div class="card__body modal-card__body">
            <p class="card__eyebrow">INSERT LINK</p>
            <h2 class="modal__title">Please select text before inserting a link</h2>
            <p class="modal__supporting">Select the text where you want to add the link. Then click the Insert link button again.</p>
            <div class="modal__actions">
              ${primaryButton("Ok", "close-editor-insert-link-modal")}
            </div>
          </div>
        </section>
      </div>
    `;
  }

  const urlDraft = String(modal.urlDraft ?? "");
  const isValid = Boolean(validateEditorLinkUrl(urlDraft));
  const showError = urlDraft.trim().length > 0 && !isValid;

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact modal-card--insert-link">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">INSERT LINK</p>
          <h2 class="modal__title">Paste the link URL</h2>
          <p class="modal__supporting">Paste the link url below to insert a link on the selected text</p>
          <div class="modal__form">
            <label class="field">
              <input
                class="field__input"
                type="text"
                placeholder="Enter link url"
                value="${escapeHtml(urlDraft)}"
                data-editor-insert-link-url-input
              />
            </label>
            <p class="editor-insert-link-modal__error"${showError ? "" : " hidden"} data-editor-insert-link-url-error>Enter a valid URL</p>
          </div>
          <div class="modal__actions">
            ${secondaryButton("Cancel", "close-editor-insert-link-modal")}
            ${primaryButton("Ok", "submit-editor-insert-link", { disabled: !isValid })}
          </div>
        </div>
      </section>
    </div>
  `;
}
