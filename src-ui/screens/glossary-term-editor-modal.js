import { escapeHtml, loadingPrimaryButton, secondaryButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";

function renderVariantRow(side, value, index, total, isSubmitting) {
  const removeDisabled = isSubmitting;
  const inputLabel = `${side === "source" ? "Source" : "Target"} variant ${index + 1}`;
  const showRemoveButton = total > 1;
  const dragLabel = "Drag to move more likely variants to the top of the list.";
  const dragHandleMarkup =
    total > 1
      ? `
        <button
          class="term-variant-row__drag-handle"
          type="button"
          data-glossary-term-variant-handle
          aria-label="${escapeHtml(dragLabel)}"
          data-tooltip="${escapeHtml(dragLabel)}"
          ${isSubmitting ? "disabled" : ""}
        >
          <span class="term-variant-row__drag-dots" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
            <span></span>
            <span></span>
            <span></span>
          </span>
        </button>
      `
      : '<span class="term-variant-row__drag-spacer" aria-hidden="true"></span>';
  const removeButtonMarkup = showRemoveButton
    ? `
        <button
          class="term-variant-row__action-button term-variant-row__action-button--remove"
          type="button"
          data-action="remove-glossary-term-variant:${escapeHtml(side)}:${index}"
          aria-label="Remove variant"
          data-tooltip="Remove variant"
          ${removeDisabled ? "disabled" : ""}
        ><span class="term-variant-row__remove-icon" aria-hidden="true"></span></button>
      `
    : '<span class="term-variant-row__action-spacer" aria-hidden="true"></span>';

  return `
    <div
      class="term-variant-row"
      data-glossary-term-variant-row
      data-variant-side="${escapeHtml(side)}"
      data-variant-index="${index}"
    >
      <div class="term-variant-row__shell">
        <input
          class="field__input term-variant-row__input"
          type="text"
          aria-label="${escapeHtml(inputLabel)}"
          placeholder="Enter term..."
          value="${escapeHtml(value)}"
          data-glossary-term-variant-input
          data-variant-side="${escapeHtml(side)}"
          data-variant-index="${index}"
          ${isSubmitting ? "disabled" : ""}
        />
        <div class="term-variant-row__actions">
          ${dragHandleMarkup}
          ${removeButtonMarkup}
        </div>
      </div>
    </div>
  `;
}

function renderVariantLane(side, languageName, values, isSubmitting) {
  return `
    <section class="term-lane">
      <div class="term-lane__header">
        <h3 class="term-lane__title">${escapeHtml(languageName)}</h3>
      </div>
      <div class="term-lane__rows">
        ${values
          .map((value, index) => renderVariantRow(side, value, index, values.length, isSubmitting))
          .join("")}
      </div>
      <div class="term-lane__add-row">
        <button
          class="term-lane__add-button"
          type="button"
          data-action="add-glossary-term-variant:${escapeHtml(side)}"
          aria-label="Add variant"
          data-tooltip="Add variant"
          ${isSubmitting ? "disabled" : ""}
        ><span class="term-lane__add-icon" aria-hidden="true"></span></button>
      </div>
    </section>
  `;
}

export function renderGlossaryTermEditorModal(state) {
  const editor = state.glossaryTermEditor;
  if (!editor?.isOpen) {
    return "";
  }

  const isSubmitting = editor.status === "loading";
  const sourceLanguageName = state.glossaryEditor?.sourceLanguage?.name ?? "Source";
  const targetLanguageName = state.glossaryEditor?.targetLanguage?.name ?? "Target";
  const errorMarkup = editor.error
    ? `<p class="modal__error">${escapeHtml(formatErrorForDisplay(editor.error))}</p>`
    : "";
  const submitButton = loadingPrimaryButton({
    label: editor.termId ? "Save Term" : "Add Term",
    loadingLabel: "Saving...",
    action: "submit-glossary-term-editor",
    isLoading: isSubmitting,
  });
  const cancelButton = secondaryButton("Cancel", "cancel-glossary-term-editor", {
    disabled: isSubmitting,
  });

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--glossary-term">
        <div class="card__body modal-card__body glossary-term-modal">
          <h2 class="modal__title">${editor.termId ? "Edit Term" : "New Term"}</h2>

          <div class="glossary-term-modal__lanes">
            ${renderVariantLane("source", sourceLanguageName, editor.sourceTerms, isSubmitting)}
            ${renderVariantLane("target", targetLanguageName, editor.targetTerms, isSubmitting)}
          </div>

          <section class="glossary-term-modal__details">
            <div class="glossary-term-modal__details-grid">
              <label class="field">
                <span class="field__label">Notes</span>
                <textarea class="field__textarea" placeholder="Internal guidance for translators" data-glossary-term-notes-input ${isSubmitting ? "disabled" : ""}>${escapeHtml(editor.notesToTranslators)}</textarea>
              </label>
              <label class="field">
                <span class="field__label">Footnote</span>
                <textarea class="field__textarea" placeholder="Optional publishable explanatory footnote" data-glossary-term-footnote-input ${isSubmitting ? "disabled" : ""}>${escapeHtml(editor.footnote)}</textarea>
              </label>
            </div>
          </section>

          ${errorMarkup}

          <div class="modal__actions">
            ${cancelButton}
            ${submitButton}
          </div>
        </div>
      </section>
    </div>
  `;
}
