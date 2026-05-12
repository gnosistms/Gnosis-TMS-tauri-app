import { escapeHtml, primaryButton, secondaryButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import { findIsoLanguageOption, isoLanguageOptions } from "../lib/language-options.js";

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
  const selectedCode = findIsoLanguageOption(modal.selectedSourceLanguageCode)?.code ?? "";
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

function renderProjectImportLinkErrorModal(modal) {
  const errorModal = modal?.linkErrorModal;
  if (errorModal === "accessDenied") {
    return `
      <div class="modal-backdrop">
        <section class="card modal-card modal-card--compact">
          <div class="card__body modal-card__body">
            <p class="card__eyebrow">FILE NOT SHARED PUBLICLY</p>
            <h2 class="modal__title">Please share this file with everyone</h2>
            <p class="modal__supporting">Please open this file in your web browser and share it to &quot;Anyone with the link&quot;.</p>
            <div class="modal__actions">
              ${secondaryButton("Cancel", "close-project-import-link-error")}
              ${primaryButton("Retry", "retry-project-import-link")}
            </div>
          </div>
        </section>
      </div>
    `;
  }

  if (errorModal === "invalid") {
    return `
      <div class="modal-backdrop">
        <section class="card modal-card modal-card--compact">
          <div class="card__body modal-card__body">
            <p class="card__eyebrow">INVALID LINK</p>
            <h2 class="modal__title">This link can not be opened</h2>
            <p class="modal__supporting">This link is not readable. The exact reason is unknown. Note that only Google Docs, Google Sheets, and HTML website links are supported.</p>
            <div class="modal__actions">
              ${primaryButton("Cancel", "close-project-import-link-error")}
            </div>
          </div>
        </section>
      </div>
    `;
  }

  return "";
}

function normalizeProjectImportInputMode(value) {
  const mode = String(value ?? "").trim();
  return mode === "pasteLink" || mode === "pasteText" ? mode : "upload";
}

function renderProjectImportModeButton(mode, label, selectedMode, disabled) {
  const isActive = mode === selectedMode;
  return `
    <button
      type="button"
      class="segmented-control__button${isActive ? " is-active" : ""}"
      data-action="select-project-import-input-mode:${escapeHtml(mode)}"
      aria-pressed="${isActive ? "true" : "false"}"
      ${disabled ? 'disabled aria-disabled="true"' : ""}
    >
      ${escapeHtml(label)}
    </button>
  `;
}

function renderProjectImportModeControl(selectedMode, disabled) {
  return `
    <div class="segmented-control project-import-modal__mode-control" role="group" aria-label="Add file method">
      ${renderProjectImportModeButton("upload", "Upload", selectedMode, disabled)}
      ${renderProjectImportModeButton("pasteLink", "Paste link", selectedMode, disabled)}
      ${renderProjectImportModeButton("pasteText", "Paste text", selectedMode, disabled)}
    </div>
  `;
}

function renderProjectImportUploadPanel(isImporting) {
  return `
    <button
      type="button"
      class="project-import-modal__drop-target${isImporting ? " is-loading" : ""}"
      data-action="select-project-import-file"
      data-project-import-dropzone
      ${isImporting ? 'disabled aria-disabled="true"' : ""}
    >
      ${isImporting ? '<span class="button__spinner" aria-hidden="true"></span>' : ""}
      <span>Drop files here or click to open the file selector.</span>
    </button>
    <p class="project-import-modal__hint">Supported formats: .xlsx, .txt, or .docx. For .xlsx files, the first row must contain supported language codes such as es, en, vi, zh-Hans, or zh-Hant.</p>
  `;
}

function renderProjectImportLinkPanel(modal, disabled) {
  const value = typeof modal?.linkUrl === "string" ? modal.linkUrl : "";
  return `
    <label class="field">
      <input
        id="project-import-link-input"
        class="field__input"
        type="url"
        inputmode="url"
        aria-label="Paste link"
        autocomplete="off"
        spellcheck="false"
        data-project-import-link-input
        value="${escapeHtml(value)}"
        placeholder="https://docs.google.com/..."
        ${disabled ? 'disabled aria-disabled="true"' : ""}
      />
      <span class="project-import-modal__hint">Paste link here. Supports Google Docs, Google Sheets, and HTML web pages.</span>
    </label>
  `;
}

function renderProjectImportPasteTextPanel(modal, disabled) {
  const value = typeof modal?.pastedText === "string" ? modal.pastedText : "";
  return `
    <label class="field">
      <textarea
        class="field__textarea"
        rows="10"
        placeholder="Paste text here."
        data-project-import-paste-textarea
        ${disabled ? 'disabled aria-disabled="true"' : ""}
      >${escapeHtml(value)}</textarea>
      <span class="project-import-modal__hint">Paste plain text here. You will choose its source language before importing.</span>
    </label>
  `;
}

export function renderProjectImportModal(state) {
  const modal = state.projectImport;
  const batchErrorMarkup = renderProjectImportBatchErrorModal(modal);
  if (batchErrorMarkup) {
    return batchErrorMarkup;
  }

  const linkErrorMarkup = renderProjectImportLinkErrorModal(modal);
  if (linkErrorMarkup) {
    return linkErrorMarkup;
  }

  if (!modal?.isOpen) {
    return "";
  }

  if (modal.status === "selectingSourceLanguage") {
    return renderSourceLanguageStep(modal);
  }

  const isImporting = modal.status === "importing";
  const isResolvingLink = modal.status === "resolvingLink";
  const controlsDisabled = isImporting || isResolvingLink;
  const projectTitle = String(modal.projectTitle ?? "").trim() || "this project";
  const inputMode = normalizeProjectImportInputMode(modal.inputMode);
  const isUploadMode = inputMode === "upload";
  const isPasteLinkMode = inputMode === "pasteLink";
  const isPasteTextMode = inputMode === "pasteText";
  const linkUrl = String(modal.linkUrl ?? "").trim();
  const pastedText = String(modal.pastedText ?? "").trim();
  const errorMarkup = modal.error
    ? `<div class="project-import-modal__error-badge" role="alert">${escapeHtml(formatErrorForDisplay(modal.error))}</div>`
    : "";
  const primaryLabel = isPasteLinkMode
    ? (isResolvingLink ? "Opening..." : "Continue")
    : isUploadMode
    ? (isImporting ? "Uploading..." : "Select files")
    : isPasteTextMode
    ? (isImporting ? "Importing..." : "Continue")
    : "Continue";
  const primaryAction = isPasteLinkMode
    ? "submit-project-import-link"
    : isUploadMode
    ? "select-project-import-file"
    : isPasteTextMode ? "submit-project-import-pasted-text" : "noop";
  const primaryDisabled = controlsDisabled
    || (!isUploadMode && !isPasteLinkMode && !isPasteTextMode)
    || (isPasteLinkMode && !linkUrl)
    || (isPasteTextMode && !pastedText);

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact modal-card--project-import">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">ADD FILE</p>
          <h2 class="modal__title">Add file</h2>
          <p class="modal__supporting">Choose how to add content to ${escapeHtml(projectTitle)}.</p>
          <div class="modal__form project-import-modal">
            ${errorMarkup}
            ${renderProjectImportModeControl(inputMode, controlsDisabled)}
            ${isUploadMode
              ? renderProjectImportUploadPanel(isImporting)
              : isPasteLinkMode
                ? renderProjectImportLinkPanel(modal, controlsDisabled)
                : renderProjectImportPasteTextPanel(modal, controlsDisabled)}
          </div>
          <div class="modal__actions project-import-modal__actions">
            ${secondaryButton("Cancel", "cancel-project-import", { disabled: controlsDisabled })}
            ${primaryButton(primaryLabel, primaryAction, { disabled: primaryDisabled })}
          </div>
        </div>
      </section>
    </div>
  `;
}
