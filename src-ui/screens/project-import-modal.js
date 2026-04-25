import { escapeHtml, primaryButton, secondaryButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import { isoLanguageOptions } from "../lib/language-options.js";

function renderSourceLanguageOption(language, selectedCode) {
  const isSelected = language.code === selectedCode;
  return `
    <button
      class="language-picker-modal__option${isSelected ? " is-selected" : ""}"
      type="button"
      data-action="select-project-import-source-language:${escapeHtml(language.code)}"
      aria-pressed="${isSelected ? "true" : "false"}"
    >
      <span>${escapeHtml(language.name)}</span>
      <span class="language-picker-modal__code">${escapeHtml(language.code)}</span>
    </button>
  `;
}

function renderSourceLanguageStep(modal) {
  const selectedCode = String(modal.selectedSourceLanguageCode ?? "").trim().toLowerCase();
  const isBatch = modal.isBatch === true;
  const fileLabel = isBatch ? "these files" : "this file";
  const languages = isoLanguageOptions
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name));

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact modal-card--language-picker">
        <div class="card__body modal-card__body language-picker-modal">
          <p class="card__eyebrow">SOURCE LANGUAGE</p>
          <h2 class="modal__title">What is the language of ${fileLabel}?</h2>
          <p class="modal__supporting">Select the language of ${fileLabel} from the list below. This will be the source language.</p>
          <div class="language-picker-modal__list" role="list" data-project-import-source-language-list>
            ${languages.map((language) => renderSourceLanguageOption(language, selectedCode)).join("")}
          </div>
          <div class="modal__actions">
            ${secondaryButton("Cancel", "cancel-project-import")}
            ${primaryButton("Continue", "continue-project-import-text", { disabled: !selectedCode })}
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderProjectImportBatchErrorModal(modal) {
  const failedFileNames = Array.isArray(modal?.failedFileNames)
    ? modal.failedFileNames.filter((fileName) => String(fileName ?? "").trim())
    : [];
  if (failedFileNames.length === 0) {
    return "";
  }

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">FILE UPLOAD ERROR</p>
          <h2 class="modal__title">Some files were not uploaded</h2>
          <p class="modal__supporting">The following files did not upload successfully:</p>
          <ul class="modal__list">
            ${failedFileNames.map((fileName) => `<li>${escapeHtml(fileName)}</li>`).join("")}
          </ul>
          <div class="modal__actions">
            ${primaryButton("Ok", "close-project-import-upload-error")}
          </div>
        </div>
      </section>
    </div>
  `;
}

export function renderProjectImportModal(state) {
  const modal = state.projectImport;
  const batchErrorMarkup = renderProjectImportBatchErrorModal(modal);
  if (batchErrorMarkup) {
    return batchErrorMarkup;
  }

  if (!modal?.isOpen) {
    return "";
  }

  if (modal.status === "selectingSourceLanguage") {
    return renderSourceLanguageStep(modal);
  }

  const isImporting = modal.status === "importing";
  const projectTitle = String(modal.projectTitle ?? "").trim() || "this project";
  const errorMarkup = modal.error
    ? `<div class="project-import-modal__error-badge" role="alert">${escapeHtml(formatErrorForDisplay(modal.error))}</div>`
    : "";

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact modal-card--project-import">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">ADD FILE</p>
          <h2 class="modal__title">Upload a file</h2>
          <p class="modal__supporting">Add a supported file to ${escapeHtml(projectTitle)}.</p>
          <div class="modal__form project-import-modal">
            ${errorMarkup}
            <button
              type="button"
              class="project-import-modal__drop-target${isImporting ? " is-loading" : ""}"
              data-action="select-project-import-file"
              data-project-import-dropzone
              ${isImporting ? 'disabled aria-disabled="true"' : ""}
            >
              ${isImporting ? '<span class="button__spinner" aria-hidden="true"></span>' : ""}
              <span>Drop a file here or click to open a file selector.</span>
            </button>
            <p class="project-import-modal__hint">Supported formats: .xlsx, .txt, or .docx. For .xlsx files, the first row must contain valid ISO 639-1 two-letter language codes such as es, en, or vi.</p>
          </div>
          <div class="modal__actions">
            ${secondaryButton("Cancel", "cancel-project-import", { disabled: isImporting })}
            ${primaryButton(isImporting ? "Uploading..." : "Select File", "select-project-import-file", { disabled: isImporting })}
          </div>
        </div>
      </section>
    </div>
  `;
}
