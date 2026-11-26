import { escapeHtml, primaryButton, secondaryButton, tooltipAttributes } from "../lib/ui.js";
import { insertLinkEditor, validateEditorLinkUrl } from "../app/editor-link-flow.js";

export function renderInsertLinkButton({ scope = "editor", rowId, languageCode, side, disabled = false }) {
  const chapter = scope === "editor";
  const target = chapter
    ? `data-row-id="${escapeHtml(rowId)}" data-language-code="${escapeHtml(languageCode)}"`
    : `data-modal-focus-key="insert-link-${side ?? scope}"`;
  return `
    <button class="${chapter ? "translation-row-text-style-button" : "term-lane__add-button"} translation-row-text-style-button--link"
      type="button" data-action="open-${scope}-insert-link" data-editor-link-button ${target}
      aria-label="Insert HTML link" aria-haspopup="dialog" ${disabled ? "disabled" : ""}
      ${tooltipAttributes("Insert HTML link", { side: "top", align: side === "target" ? "end" : undefined })}>
      <span class="translation-row-text-style-button__label" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M15 7h3a5 5 0 0 1 0 10h-3" />
          <path d="M9 17H6A5 5 0 0 1 6 7h3" />
          <line x1="8" y1="12" x2="16" y2="12" />
        </svg>
      </span>
    </button>`;
}

export function renderEditorInsertLinkModal(state, scope = "editor") {
  const modal = insertLinkEditor(state, scope)?.insertLinkModal;
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
              ${primaryButton("Ok", `close-${scope}-insert-link-modal`, {
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
                data-editor-insert-link-url-input="${scope}"
                aria-label="Link URL"
                data-modal-initial-focus
              />
            </label>
            <p class="editor-insert-link-modal__error"${showError ? "" : " hidden"} data-editor-insert-link-url-error>Enter a valid URL</p>
          </div>
          <div class="modal__actions">
            ${secondaryButton("Cancel", `close-${scope}-insert-link-modal`, {
              modalCancel: true,
            })}
            ${primaryButton("Ok", `submit-${scope}-insert-link`, {
              disabled: !isValid,
              modalDefault: true,
            })}
          </div>
        </div>
      </section>
    </div>
  `;
}
