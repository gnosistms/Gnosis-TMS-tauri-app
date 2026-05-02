import { errorButton, escapeHtml, secondaryButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";

function languageName(language) {
  const code = String(language?.code ?? "").trim();
  return String(language?.name ?? "").trim() || code;
}

function renderDisabledButton(label, className = "button--primary") {
  return `
    <button class="button ${escapeHtml(className)} is-disabled" data-action="noop" disabled aria-disabled="true">
      <span>${escapeHtml(label)}</span>
    </button>
  `;
}

function renderLanguageCheckboxes(languages, selectedLanguageCodes, disabled) {
  if (languages.length === 0) {
    return '<p class="modal__supporting">There are no languages in this file.</p>';
  }

  const selected = new Set(Array.isArray(selectedLanguageCodes) ? selectedLanguageCodes : []);
  return `
    <div class="ai-translate-all-modal__language-list">
      ${languages.map((language) => {
        const code = String(language?.code ?? "").trim();
        return `
          <label class="field__checkbox ai-translate-all-modal__language">
            <input
              type="checkbox"
              data-editor-clear-translations-language
              value="${escapeHtml(code)}"
              ${selected.has(code) ? "checked" : ""}
              ${disabled ? "disabled" : ""}
            />
            <span>${escapeHtml(languageName(language))}</span>
          </label>
        `;
      }).join("")}
    </div>
  `;
}

function renderSelectedLanguageList(languages, selectedLanguageCodes) {
  const selected = new Set(Array.isArray(selectedLanguageCodes) ? selectedLanguageCodes : []);
  const selectedLanguages = languages.filter((language) =>
    selected.has(String(language?.code ?? "").trim()),
  );
  if (selectedLanguages.length === 0) {
    return "";
  }

  return `
    <ul class="modal__list">
      ${selectedLanguages.map((language) => `<li>${escapeHtml(languageName(language))}</li>`).join("")}
    </ul>
  `;
}

export function renderEditorClearTranslationsModal(state) {
  const modal = state.editorChapter?.clearTranslationsModal;
  if (!modal?.isOpen) {
    return "";
  }

  const languages = Array.isArray(state.editorChapter?.languages) ? state.editorChapter.languages : [];
  const isSubmitting = modal.status === "loading";
  const selectedLanguageCodes = Array.isArray(modal.selectedLanguageCodes)
    ? modal.selectedLanguageCodes
    : [];
  const hasSelection = selectedLanguageCodes.some((code) =>
    languages.some((language) => language?.code === code),
  );
  const errorMarkup = modal.error
    ? `<p class="modal__error">${escapeHtml(formatErrorForDisplay(modal.error))}</p>`
    : "";
  const cancelButton = secondaryButton("Cancel", "cancel-editor-clear-translations", {
    disabled: isSubmitting,
  });

  if (modal.step === "confirm") {
    const deleteButton = isSubmitting
      ? renderDisabledButton("Delete", "button--error")
      : errorButton("Delete", "confirm-editor-clear-translations");

    return `
      <div class="modal-backdrop">
        <section class="card modal-card modal-card--compact modal-card--ai-translate-all">
          <div class="card__body modal-card__body ai-translate-all-modal">
            <p class="card__eyebrow">Confirm deletion</p>
            <h2 class="modal__title">Are you sure you want to delete these translations?</h2>
            <p class="modal__supporting">
              All translations in this file for the following languages will be deleted:
            </p>
            ${renderSelectedLanguageList(languages, selectedLanguageCodes)}
            <p class="modal__supporting">
              The existing translations will remain visible in the history.
            </p>
            ${errorMarkup}
            <div class="modal__actions">
              ${cancelButton}
              ${deleteButton}
            </div>
          </div>
        </section>
      </div>
    `;
  }

  const clearButton = hasSelection
    ? `
      <button class="button button--primary" data-action="review-editor-clear-translations">
        <span>Clear selected</span>
      </button>
    `
    : renderDisabledButton("Clear selected");

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact modal-card--ai-translate-all">
        <div class="card__body modal-card__body ai-translate-all-modal">
          <p class="card__eyebrow">Clear translations</p>
          <h2 class="modal__title">Clear all translations for selected languages</h2>
          <p class="modal__supporting">
            Select the languages for which you want to clear the translations.
          </p>
          ${renderLanguageCheckboxes(languages, selectedLanguageCodes, isSubmitting)}
          ${errorMarkup}
          <div class="modal__actions">
            ${cancelButton}
            ${clearButton}
          </div>
        </div>
      </section>
    </div>
  `;
}
