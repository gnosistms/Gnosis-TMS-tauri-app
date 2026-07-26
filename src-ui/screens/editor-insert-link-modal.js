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
        <section class="card modal-card modal-card--compact modal-card--insert-link" role="dialog" aria-modal="true" aria-labelledby="editor-insert-link-no-selection-modal-title" data-modal-dialog="editor-insert-link:no-selection" tabindex="-1">
          <div class="card__body modal-card__body">
            <p class="card__eyebrow">INSERT LINK</p>
            <h2 class="modal__title" id="editor-insert-link-no-selection-modal-title">Please select text before inserting a link</h2>
            <p class="modal__supporting">Select the text where you want to add the link. Then click the Insert link button again.</p>
            <div class="modal__actions">
              ${primaryButton("Ok", "close-editor-insert-link-modal", {
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

  const urlDraft = String(modal.urlDraft ?? "");
  const isValid = Boolean(validateEditorLinkUrl(urlDraft));
  const showError = urlDraft.trim().length > 0 && !isValid;

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact modal-card--insert-link" role="dialog" aria-modal="true" aria-labelledby="editor-insert-link-url-modal-title" data-modal-dialog="editor-insert-link:url" tabindex="-1">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">INSERT LINK</p>
          <h2 class="modal__title" id="editor-insert-link-url-modal-title">Paste the link URL</h2>
          <p class="modal__supporting">Paste the link url below to insert a link on the selected text</p>
          <div class="modal__form">
            <label class="field">
              <input
                class="field__input"
                type="text"
                placeholder="Enter link url"
                value="${escapeHtml(urlDraft)}"
                data-editor-insert-link-url-input
                data-modal-initial-focus
              />
            </label>
            <p class="editor-insert-link-modal__error"${showError ? "" : " hidden"} data-editor-insert-link-url-error>Enter a valid URL</p>
          </div>
          <div class="modal__actions">
            ${secondaryButton("Cancel", "close-editor-insert-link-modal", {
              modalCancel: true,
            })}
            ${primaryButton("Ok", "submit-editor-insert-link", {
              disabled: !isValid,
              modalDefault: true,
            })}
          </div>
        </div>
      </section>
    </div>
  `;
}
