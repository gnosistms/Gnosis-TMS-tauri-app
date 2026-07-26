import { escapeHtml, primaryButton, secondaryButton } from "../lib/ui.js";
import { findIsoLanguageOption, isoLanguageOptions } from "../lib/language-options.js";
import {
  normalizeProjectDocumentInputMode,
  renderProjectDocumentInputModal,
  renderProjectDocumentLinkError,
} from "../app/project-document-input.js";

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
          <div class="language-picker-modal__list-frame">
            <div class="language-picker-modal__list" role="list" data-project-import-source-language-list>
              ${languages.map((language) => renderSourceLanguageOption(language, selectedCode)).join("")}
            </div>
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


function renderProjectImportUploadProgressStep(modal) {
  const projectTitle = String(modal?.projectTitle ?? "").trim() || "this project";
  const total = Math.max(1, Number.parseInt(String(modal?.uploadProgress?.total ?? 1), 10) || 1);
  const current = Math.min(
    total,
    Math.max(1, Number.parseInt(String(modal?.uploadProgress?.current ?? 1), 10) || 1),
  );
  const percent = Math.min(100, Math.max(0, Math.round((current / total) * 100)));

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact modal-card--project-import" role="status" aria-busy="true">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">Uploading</p>
          <h2 class="modal__title">Importing files to ${escapeHtml(projectTitle)}</h2>
          <div class="project-import-modal__upload-progress">
            <div class="ai-translate-all-modal__progress-row">
              <div class="ai-translate-all-modal__progress-label">
                <span>Importing ${escapeHtml(String(current))} of ${escapeHtml(String(total))}</span>
                <span>${escapeHtml(String(percent))}%</span>
              </div>
              <div
                class="ai-translate-all-modal__progress-track"
                role="progressbar"
                aria-label="File import progress"
                aria-valuemin="0"
                aria-valuemax="${escapeHtml(String(total))}"
                aria-valuenow="${escapeHtml(String(current))}"
              >
                <div class="ai-translate-all-modal__progress-fill" style="width: ${escapeHtml(String(percent))}%;"></div>
              </div>
            </div>
          </div>
          <div class="modal__actions project-import-modal__actions">
            ${secondaryButton("Cancel", "cancel-project-import")}
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

  const linkErrorMarkup = renderProjectDocumentLinkError(modal, {
    closeAction: "close-project-import-link-error",
    retryAction: "retry-project-import-link",
    invalidMessage: "This link is not readable. The exact reason is unknown. Note that only Google Docs, Google Sheets, HTML website links, and local file paths are supported.",
  });
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
  const projectTitle = String(modal.projectTitle ?? "").trim() || "this project";
  const inputMode = normalizeProjectDocumentInputMode(modal.inputMode);
  const isUploadMode = inputMode === "upload";
  if (isImporting && isUploadMode) {
    return renderProjectImportUploadProgressStep(modal);
  }
  return renderProjectDocumentInputModal(modal, {
    eyebrow: "ADD FILES",
    title: "Add new files to the project",
    supportingText: `Choose how to add content to ${projectTitle}.`,
    modeAriaLabel: "Add file method",
    selectModeAction: "select-project-import-input-mode",
    selectFileAction: "select-project-import-file",
    submitLinkAction: "submit-project-import-link",
    submitPasteAction: "submit-project-import-pasted-text",
    cancelAction: "cancel-project-import",
    dropzoneAttribute: "data-project-import-dropzone",
    dropzoneLabel: "Drop files here or click to open the file selector.",
    uploadHint: "Supported formats: .xlsx, .txt, .srt, .docx, .html, or .htm. For .xlsx files, the first row must contain supported language codes such as es, en, vi, zh-Hans, or zh-Hant.",
    linkInputId: "project-import-link-input",
    linkInputAttribute: "data-project-import-link-input",
    linkPlaceholder: "https://docs.google.com/...",
    linkHint: "Paste link here. Supports Google Docs, Google Sheets, HTML web pages, and local file paths.",
    pasteInputAttribute: "data-project-import-paste-textarea",
    pastePlaceholder: "Paste text here.",
    pasteHint: "Paste plain text here. You will choose its source language before importing.",
    selectFileLabel: "Select files",
    processingUploadLabel: "Uploading...",
    processingPasteLabel: "Importing...",
    controlsDisabled: isImporting || isResolvingLink,
    isResolvingLink,
    isProcessingUpload: isImporting,
    isProcessingPaste: isImporting,
  });
}
