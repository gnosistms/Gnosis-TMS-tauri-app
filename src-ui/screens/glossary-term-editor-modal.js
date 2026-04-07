import { escapeHtml, loadingPrimaryButton, secondaryButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";

function renderVariantRow(side, value, index, total, isSubmitting) {
  const moveUpDisabled = isSubmitting || index === 0;
  const moveDownDisabled = isSubmitting || index === total - 1;
  const removeDisabled = isSubmitting;
  const inputLabel = `${side === "source" ? "Source" : "Target"} variant ${index + 1}`;

  return `
    <div class="term-variant-row">
      <div class="term-variant-row__identity">
        <span class="term-variant-row__rank">${index + 1}</span>
        ${index === 0 ? '<span class="term-variant-row__primary">Primary</span>' : ""}
      </div>
      <input
        class="field__input term-variant-row__input"
        type="text"
        aria-label="${escapeHtml(inputLabel)}"
        placeholder="${side === "source" ? "Enter source term" : "Enter target term"}"
        value="${escapeHtml(value)}"
        data-glossary-term-variant-input
        data-variant-side="${escapeHtml(side)}"
        data-variant-index="${index}"
        ${isSubmitting ? "disabled" : ""}
      />
      <div class="term-variant-row__actions">
        <button
          class="term-variant-row__action-button"
          type="button"
          data-action="move-up-glossary-term-variant:${escapeHtml(side)}:${index}"
          aria-label="Move variant up"
          title="Move up"
          ${moveUpDisabled ? "disabled" : ""}
        >^</button>
        <button
          class="term-variant-row__action-button"
          type="button"
          data-action="move-down-glossary-term-variant:${escapeHtml(side)}:${index}"
          aria-label="Move variant down"
          title="Move down"
          ${moveDownDisabled ? "disabled" : ""}
        >v</button>
        <button
          class="term-variant-row__action-button term-variant-row__action-button--remove"
          type="button"
          data-action="remove-glossary-term-variant:${escapeHtml(side)}:${index}"
          aria-label="Remove variant"
          title="Remove variant"
          ${removeDisabled ? "disabled" : ""}
        >x</button>
      </div>
    </div>
  `;
}

function renderVariantLane(side, languageName, values, isSubmitting, untranslated) {
  const helperText =
    side === "target" && untranslated
      ? "Top to bottom = most to least likely. Leave these blank if the source term stays untranslated."
      : "Top to bottom = most to least likely. Row 1 is the preferred term.";

  return `
    <section class="term-lane">
      <div class="term-lane__header">
        <div class="term-lane__copy">
          <p class="card__eyebrow">${side === "source" ? "SOURCE" : "TARGET"}</p>
          <h3 class="term-lane__title">${escapeHtml(languageName)}</h3>
        </div>
        <span class="term-lane__badge">Most Likely First</span>
      </div>
      <p class="term-lane__supporting">${escapeHtml(helperText)}</p>
      <div class="term-lane__rows">
        ${values
          .map((value, index) => renderVariantRow(side, value, index, values.length, isSubmitting))
          .join("")}
      </div>
      <button
        class="term-lane__add-button"
        type="button"
        data-action="add-glossary-term-variant:${escapeHtml(side)}"
        ${isSubmitting ? "disabled" : ""}
      >+ Add Variant</button>
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
          <p class="card__eyebrow">${editor.termId ? "EDIT TERM" : "NEW TERM"}</p>
          <h2 class="modal__title">${editor.termId ? "Edit Term" : "New Term"}</h2>
          <p class="modal__supporting">
            Rank source and target variants by likelihood. The first row in each column is treated as the primary wording.
          </p>

          <div class="glossary-term-modal__lanes">
            ${renderVariantLane("source", sourceLanguageName, editor.sourceTerms, isSubmitting, editor.untranslated)}
            ${renderVariantLane("target", targetLanguageName, editor.targetTerms, isSubmitting, editor.untranslated)}
          </div>

          <section class="glossary-term-modal__details">
            <div class="glossary-term-modal__details-header">
              <div>
                <p class="card__eyebrow">GUIDANCE</p>
                <h3 class="glossary-term-modal__details-title">Translator Context</h3>
              </div>
              <p class="glossary-term-modal__details-supporting">
                Notes and footnotes are optional. Keep the ranking above focused on the actual term choices.
              </p>
            </div>

            <label class="field__checkbox glossary-term-modal__checkbox">
              <input
                type="checkbox"
                data-glossary-term-untranslated-input
                ${editor.untranslated ? "checked" : ""}
                ${isSubmitting ? "disabled" : ""}
              />
              <span>Use the source term untranslated when no target variant should be supplied.</span>
            </label>

            <div class="glossary-term-modal__details-grid">
              <label class="field">
                <span class="field__label">Notes To Translators</span>
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
