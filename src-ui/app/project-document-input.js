import { escapeHtml, primaryButton, secondaryButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "./error-display.js";

export function normalizeProjectDocumentInputMode(value) {
  const mode = String(value ?? "").trim();
  return mode === "pasteLink" || mode === "pasteText" ? mode : "upload";
}

function renderModeButton(mode, label, selectedMode, disabled, actionPrefix) {
  const isActive = mode === selectedMode;
  return `
    <button
      type="button"
      class="segmented-control__button${isActive ? " is-active" : ""}"
      data-action="${escapeHtml(actionPrefix)}:${escapeHtml(mode)}"
      aria-pressed="${isActive ? "true" : "false"}"
      ${disabled ? 'disabled aria-disabled="true"' : ""}
    >
      ${escapeHtml(label)}
    </button>
  `;
}

function renderModeControl(selectedMode, disabled, config) {
  return `
    <div class="segmented-control project-document-input__mode-control project-import-modal__mode-control" role="group" aria-label="${escapeHtml(config.modeAriaLabel)}">
      ${renderModeButton("upload", "Upload", selectedMode, disabled, config.selectModeAction)}
      ${renderModeButton("pasteLink", "Paste link", selectedMode, disabled, config.selectModeAction)}
      ${renderModeButton("pasteText", "Paste text", selectedMode, disabled, config.selectModeAction)}
    </div>
  `;
}

function renderUploadPanel(config) {
  return `
    <button
      type="button"
      class="project-document-input__drop-target project-import-modal__drop-target"
      data-action="${escapeHtml(config.selectFileAction)}"
      ${config.dropzoneAttribute}
    >
      <span>${escapeHtml(config.dropzoneLabel)}</span>
    </button>
    <p class="project-document-input__hint project-import-modal__hint">${escapeHtml(config.uploadHint)}</p>
  `;
}

function renderLinkPanel(modal, disabled, config) {
  const value = typeof modal?.linkUrl === "string" ? modal.linkUrl : "";
  return `
    <label class="field">
      <input
        id="${escapeHtml(config.linkInputId)}"
        class="field__input"
        type="url"
        inputmode="url"
        aria-label="Paste link"
        autocomplete="off"
        spellcheck="false"
        ${config.linkInputAttribute}
        value="${escapeHtml(value)}"
        placeholder="${escapeHtml(config.linkPlaceholder)}"
        ${disabled ? 'disabled aria-disabled="true"' : ""}
      />
      <span class="project-document-input__hint project-import-modal__hint">${escapeHtml(config.linkHint)}</span>
    </label>
  `;
}

function renderPasteTextPanel(modal, disabled, config) {
  const value = typeof modal?.pastedText === "string" ? modal.pastedText : "";
  return `
    <label class="field">
      <textarea
        class="field__textarea"
        rows="10"
        placeholder="${escapeHtml(config.pastePlaceholder)}"
        ${config.pasteInputAttribute}
        ${disabled ? 'disabled aria-disabled="true"' : ""}
      >${escapeHtml(value)}</textarea>
      <span class="project-document-input__hint project-import-modal__hint">${escapeHtml(config.pasteHint)}</span>
    </label>
  `;
}

export function renderProjectDocumentInputModal(modal, config) {
  const inputMode = normalizeProjectDocumentInputMode(modal?.inputMode);
  const isUploadMode = inputMode === "upload";
  const isPasteLinkMode = inputMode === "pasteLink";
  const isPasteTextMode = inputMode === "pasteText";
  const controlsDisabled = config.controlsDisabled === true;
  const linkUrl = String(modal?.linkUrl ?? "").trim();
  const pastedText = String(modal?.pastedText ?? "").trim();
  const errorMarkup = modal?.error
    ? `<div class="project-document-input__error-badge project-import-modal__error-badge" role="alert">${escapeHtml(formatErrorForDisplay(modal.error))}</div>`
    : "";
  const primaryLabel = isPasteLinkMode
    ? (config.isResolvingLink ? "Opening..." : "Continue")
    : isUploadMode
      ? (config.isProcessingUpload ? config.processingUploadLabel : config.selectFileLabel)
      : isPasteTextMode
        ? (config.isProcessingPaste ? config.processingPasteLabel : "Continue")
        : "Continue";
  const primaryAction = isPasteLinkMode
    ? config.submitLinkAction
    : isUploadMode
      ? config.selectFileAction
      : config.submitPasteAction;
  const primaryDisabled = controlsDisabled
    || (isPasteLinkMode && !linkUrl)
    || (isPasteTextMode && !pastedText);

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact modal-card--project-import">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">${escapeHtml(config.eyebrow)}</p>
          <h2 class="modal__title">${escapeHtml(config.title)}</h2>
          <p class="modal__supporting">${escapeHtml(config.supportingText)}</p>
          <div class="modal__form project-document-input project-import-modal">
            ${errorMarkup}
            ${renderModeControl(inputMode, controlsDisabled, config)}
            ${isUploadMode
              ? renderUploadPanel(config)
              : isPasteLinkMode
                ? renderLinkPanel(modal, controlsDisabled, config)
                : renderPasteTextPanel(modal, controlsDisabled, config)}
          </div>
          <div class="modal__actions project-document-input__actions project-import-modal__actions">
            ${secondaryButton("Cancel", config.cancelAction, { disabled: controlsDisabled })}
            ${primaryButton(primaryLabel, primaryAction, { disabled: primaryDisabled })}
          </div>
        </div>
      </section>
    </div>
  `;
}

export function renderProjectDocumentLinkError(modal, config) {
  if (modal?.linkErrorModal === "accessDenied") {
    return `
      <div class="modal-backdrop">
        <section class="card modal-card modal-card--compact">
          <div class="card__body modal-card__body">
            <p class="card__eyebrow">FILE NOT SHARED PUBLICLY</p>
            <h2 class="modal__title">Please share this file with everyone</h2>
            <p class="modal__supporting">Please open this file in your web browser and share it to &quot;Anyone with the link&quot;.</p>
            <div class="modal__actions">
              ${secondaryButton("Cancel", config.closeAction)}
              ${primaryButton("Retry", config.retryAction)}
            </div>
          </div>
        </section>
      </div>
    `;
  }

  if (modal?.linkErrorModal === "invalid") {
    return `
      <div class="modal-backdrop">
        <section class="card modal-card modal-card--compact">
          <div class="card__body modal-card__body">
            <p class="card__eyebrow">INVALID LINK</p>
            <h2 class="modal__title">This link can not be opened</h2>
            <p class="modal__supporting">${escapeHtml(config.invalidMessage)}</p>
            <div class="modal__actions">
              ${primaryButton("Cancel", config.closeAction)}
            </div>
          </div>
        </section>
      </div>
    `;
  }

  return "";
}
