import { escapeHtml, loadingPrimaryButton, secondaryButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";

export function renderGlossaryTermEditorModal(state) {
  const editor = state.glossaryTermEditor;
  if (!editor?.isOpen) {
    return "";
  }

  const isSubmitting = editor.status === "loading";
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
      <section class="card modal-card">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">${editor.termId ? "EDIT TERM" : "NEW TERM"}</p>
          <h2 class="modal__title">${editor.termId ? "Edit Glossary Term" : "Add Glossary Term"}</h2>
          <p class="modal__supporting">
            Store alternate forms as a comma-separated list. Each term is written to its own JSON file and committed locally.
          </p>
          <div class="modal__form">
            <label class="field">
              <span class="field__label">Source Terms</span>
              <input
                class="field__input"
                type="text"
                placeholder="Example: akasha, ākāśa"
                value="${escapeHtml(editor.sourceTermsText)}"
                data-glossary-term-source-input
                ${isSubmitting ? "disabled" : ""}
              />
            </label>
            <label class="field">
              <span class="field__label">Target Terms</span>
              <input
                class="field__input"
                type="text"
                placeholder="Example: ether, space"
                value="${escapeHtml(editor.targetTermsText)}"
                data-glossary-term-target-input
                ${isSubmitting ? "disabled" : ""}
              />
            </label>
            <label class="field">
              <span class="field__label">Notes To Translators</span>
              <textarea class="field__textarea" placeholder="Internal guidance for translators" data-glossary-term-notes-input ${isSubmitting ? "disabled" : ""}>${escapeHtml(editor.notesToTranslators)}</textarea>
            </label>
            <label class="field">
              <span class="field__label">Footnote</span>
              <textarea class="field__textarea" placeholder="Optional publishable explanatory footnote" data-glossary-term-footnote-input ${isSubmitting ? "disabled" : ""}>${escapeHtml(editor.footnote)}</textarea>
            </label>
            <label class="field__checkbox">
              <input
                type="checkbox"
                data-glossary-term-untranslated-input
                ${editor.untranslated ? "checked" : ""}
                ${isSubmitting ? "disabled" : ""}
              />
              <span>Use this term untranslated in the target language.</span>
            </label>
          </div>
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
