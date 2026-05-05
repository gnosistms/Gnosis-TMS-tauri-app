import { escapeHtml, primaryButton, secondaryButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import { findIsoLanguageOption, isoLanguageOptions } from "../lib/language-options.js";

function renderError(error) {
  const text = typeof error === "string" ? error.trim() : "";
  return text
    ? `<div class="project-import-modal__error-badge" role="alert">${escapeHtml(formatErrorForDisplay(text))}</div>`
    : "";
}

function renderPasteModal(modal) {
  const value = typeof modal?.pastedText === "string" ? modal.pastedText : "";
  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">Add translations</p>
          <h2 class="modal__title">Paste your translation</h2>
          <p class="modal__supporting">Paste your translation text for the entire file into the box below. Your text will be automatically aligned with the existing text and inserted.</p>
          <div class="modal__form">
            ${renderError(modal.error)}
            <textarea
              class="field__textarea"
              rows="10"
              placeholder="Paste your translation here."
              data-project-add-translation-textarea
            >${escapeHtml(value)}</textarea>
          </div>
          <div class="modal__actions">
            ${secondaryButton("Cancel", "cancel-project-add-translation")}
            ${primaryButton("Ok", "submit-project-add-translation-paste", { disabled: !value.trim() })}
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderLanguageOption(language, selectedCode) {
  const isSelected = language.code === selectedCode;
  return `
    <button
      class="language-picker-modal__option${isSelected ? " is-selected" : ""}"
      type="button"
      data-action="select-project-add-translation-language:${escapeHtml(language.code)}"
      aria-pressed="${isSelected ? "true" : "false"}"
    >
      <span>${escapeHtml(language.name)}</span>
      <span class="language-picker-modal__code">${escapeHtml(language.code)}</span>
    </button>
  `;
}

function renderLanguageModal(modal) {
  const selectedCode = findIsoLanguageOption(modal.targetLanguageCode)?.code ?? "";
  const languages = isoLanguageOptions
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name));
  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact modal-card--language-picker">
        <div class="card__body modal-card__body language-picker-modal">
          <p class="card__eyebrow">TRANSLATION LANGUAGE</p>
          <h2 class="modal__title">What language did you paste?</h2>
          <p class="modal__supporting">Select the language of the pasted translation text.</p>
          ${renderError(modal.error)}
          <div class="language-picker-modal__list" role="list">
            ${languages.map((language) => renderLanguageOption(language, selectedCode)).join("")}
          </div>
          <div class="modal__actions">
            ${secondaryButton("Cancel", "cancel-project-add-translation")}
          </div>
        </div>
      </section>
    </div>
  `;
}

function progressLabel(progress) {
  if (!progress) {
    return "";
  }
  const completed = Number(progress.completed);
  const total = Number(progress.total);
  if (Number.isFinite(completed) && Number.isFinite(total) && total > 0) {
    return `${completed} / ${total}`;
  }
  const percent = Number(progress.percent);
  return Number.isFinite(percent) ? `${Math.round(percent)}%` : "";
}

function renderProgressModal(modal) {
  const progress = modal.progress ?? {};
  const label = progress.stageLabel || (modal.step === "applying" ? "Applying translation" : "Aligning translation");
  const message = progress.message || "This may take a while.";
  const count = progressLabel(progress);
  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact modal-card--navigation-loading" role="status" aria-busy="true">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">${modal.step === "applying" ? "APPLYING" : "ALIGNING"}</p>
          <h2 class="modal__title">${escapeHtml(label)}</h2>
          <p class="modal__supporting">${escapeHtml(message)}${count ? ` ${escapeHtml(count)}` : ""}</p>
          ${renderError(modal.error)}
        </div>
      </section>
    </div>
  `;
}

function renderExistingTranslationsModal(modal) {
  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">EXISTING TRANSLATIONS</p>
          <h2 class="modal__title">This language already has translation text</h2>
          <p class="modal__supporting">When you insert to this language, your text will only be inserted into the empty rows. It will not overwrite the existing translations. If you intend to insert for the entire file, cancel and delete the existing text first.</p>
          ${renderError(modal.error)}
          <div class="modal__actions">
            ${secondaryButton("Cancel", "cancel-project-add-translation")}
            ${primaryButton("Insert to empty rows", "continue-project-add-translation-existing")}
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderMismatchModal(modal) {
  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">TEXT MISMATCH</p>
          <h2 class="modal__title">Inserted text does not match well</h2>
          <p class="modal__supporting">Much of the text does not match and can not be aligned. We recommend you check the inserted text to make sure it really is a translation of the text in this file. If you continue with the insert operation, non-similar paragraphs will be aligned with empty space.</p>
          ${renderError(modal.error)}
          <div class="modal__actions">
            ${secondaryButton("Cancel", "cancel-project-add-translation")}
            ${primaryButton("Continue", "continue-project-add-translation-mismatch")}
          </div>
        </div>
      </section>
    </div>
  `;
}

export function renderProjectAddTranslationModal(state) {
  const modal = state.projectAddTranslation;
  if (!modal?.isOpen) {
    return "";
  }
  if (modal.step === "selectLanguage") {
    return renderLanguageModal(modal);
  }
  if (modal.step === "aligning" || modal.step === "applying") {
    return renderProgressModal(modal);
  }
  if (modal.step === "existingTranslationWarning") {
    return renderExistingTranslationsModal(modal);
  }
  if (modal.step === "mismatchWarning") {
    return renderMismatchModal(modal);
  }
  return renderPasteModal(modal);
}
