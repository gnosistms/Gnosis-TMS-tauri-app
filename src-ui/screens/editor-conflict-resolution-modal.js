import { escapeHtml, loadingPrimaryButton, secondaryButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import {
  editorConflictResolutionShowsFootnotes,
  editorConflictResolutionShowsImageCaptions,
  editorConflictResolutionShowsImages,
} from "../app/editor-conflict-resolution-model.js";

function formatConflictTimestamp(value) {
  const text = String(value ?? "").trim();
  if (!text) {
    return "";
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return text;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function remoteVersionLabel(remoteVersion) {
  const authorName = String(remoteVersion?.authorName ?? "").trim();
  const committedAt = formatConflictTimestamp(remoteVersion?.committedAt);
  const parts = [authorName, committedAt, "GitHub version"].filter(Boolean);
  return parts.join(" | ") || "GitHub version";
}

function hasVersionText(value) {
  return String(value ?? "").trim().length > 0;
}

function renderVersionText(value, modifierClass = "") {
  if (!hasVersionText(value)) {
    return "";
  }

  const classes = [
    "field__textarea",
    "editor-conflict-modal__version-text",
    modifierClass,
  ].filter(Boolean).join(" ");
  return `<div class="${classes}">${escapeHtml(value)}</div>`;
}

export function renderEditorConflictResolutionModal(state) {
  const modal = state.editorChapter?.conflictResolutionModal;
  if (!modal?.isOpen) {
    return "";
  }

  const isSubmitting = modal.status === "loading";
  const showFootnotes = editorConflictResolutionShowsFootnotes(modal);
  const showImageCaptions = editorConflictResolutionShowsImageCaptions(modal);
  const showImages = editorConflictResolutionShowsImages(modal);
  const autofocusFootnote =
    showFootnotes && String(modal.localText ?? "") === String(modal.remoteText ?? "");
  const errorMarkup = modal.error
    ? `<p class="modal__error">${escapeHtml(formatErrorForDisplay(modal.error))}</p>`
    : "";
  const cancelButton = secondaryButton("Cancel", "cancel-editor-conflict-resolution", {
    disabled: isSubmitting,
  });
  const localCopyButton = secondaryButton("Copy", "copy-editor-conflict-version:local", {
    compact: true,
    disabled: isSubmitting,
  });
  const remoteCopyButton = secondaryButton("Copy", "copy-editor-conflict-version:remote", {
    compact: true,
    disabled: isSubmitting,
  });
  const saveButton = loadingPrimaryButton({
    label: "Save and finalize",
    loadingLabel: "Saving and finalizing...",
    action: "save-editor-conflict-resolution",
    isLoading: isSubmitting,
  });

  const renderVersionStack = (text, footnote, imageCaption, imageUrl) => {
    const blocks = [
      renderVersionText(text),
      showFootnotes
        ? renderVersionText(footnote, "editor-conflict-modal__version-text--footnote")
        : "",
      showImageCaptions
        ? renderVersionText(imageCaption, "editor-conflict-modal__version-text--footnote")
        : "",
      showImages
        ? renderVersionText(imageUrl, "editor-conflict-modal__version-text--footnote")
        : "",
    ].filter(Boolean);
    return `<div class="editor-conflict-modal__version-stack">${blocks.join("")}</div>`;
  };

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--editor-conflict">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">CONFLICT</p>
          <h2 class="modal__title">Resolve translation conflict</h2>
          <div class="editor-conflict-modal__versions">
            <section class="editor-conflict-modal__column">
              <p class="editor-conflict-modal__version-label">Your version</p>
              ${renderVersionStack(modal.localText, modal.localFootnote, modal.localImageCaption, modal.localImageUrl)}
              <div class="editor-conflict-modal__version-actions">
                ${localCopyButton}
              </div>
            </section>
            <section class="editor-conflict-modal__column">
              <p class="editor-conflict-modal__version-label">${escapeHtml(remoteVersionLabel(modal.remoteVersion))}</p>
              ${renderVersionStack(modal.remoteText, modal.remoteFootnote, modal.remoteImageCaption, modal.remoteImageUrl)}
              <div class="editor-conflict-modal__version-actions">
                ${remoteCopyButton}
              </div>
            </section>
          </div>
          <label class="field editor-conflict-modal__final-field">
            <span class="field__label">Resolved translation text</span>
            <textarea
              class="field__textarea editor-conflict-modal__final-input"
              data-editor-conflict-final-input
              rows="1"
              ${autofocusFootnote ? "" : "autofocus"}
              ${isSubmitting ? "disabled" : ""}
            >${escapeHtml(modal.finalText)}</textarea>
          </label>
          ${
            showFootnotes
              ? `
                <label class="field editor-conflict-modal__final-field editor-conflict-modal__final-field--footnote">
                  <span class="field__label">Resolved footnote text</span>
                  <textarea
                    class="field__textarea editor-conflict-modal__final-input editor-conflict-modal__final-input--footnote"
                    data-editor-conflict-final-footnote-input
                    rows="1"
                    placeholder="Enter footnote text here."
                    ${autofocusFootnote ? "autofocus" : ""}
                    ${isSubmitting ? "disabled" : ""}
                  >${escapeHtml(modal.finalFootnote)}</textarea>
                </label>
              `
              : ""
          }
          ${
            showImageCaptions
              ? `
                <label class="field editor-conflict-modal__final-field editor-conflict-modal__final-field--footnote">
                  <span class="field__label">Resolved image caption text</span>
                  <textarea
                    class="field__textarea editor-conflict-modal__final-input editor-conflict-modal__final-input--footnote"
                    data-editor-conflict-final-image-caption-input
                    rows="1"
                    placeholder="Enter image caption"
                    ${isSubmitting ? "disabled" : ""}
                  >${escapeHtml(modal.finalImageCaption)}</textarea>
                </label>
              `
              : ""
          }
          ${
            showImages
              ? `
                <label class="field editor-conflict-modal__final-field editor-conflict-modal__final-field--footnote">
                  <span class="field__label">Resolved image URL</span>
                  <textarea
                    class="field__textarea editor-conflict-modal__final-input editor-conflict-modal__final-input--footnote"
                    data-editor-conflict-final-image-input
                    rows="1"
                    placeholder="Enter image URL"
                    ${isSubmitting ? "disabled" : ""}
                  >${escapeHtml(modal.finalImageUrl)}</textarea>
                </label>
              `
              : ""
          }
          ${errorMarkup}
          <div class="modal__actions">
            ${cancelButton}
            ${saveButton}
          </div>
        </div>
      </section>
    </div>
  `;
}
