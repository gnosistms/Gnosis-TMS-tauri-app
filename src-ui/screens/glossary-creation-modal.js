import { escapeHtml, loadingPrimaryButton, secondaryButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";

export function renderGlossaryCreationModal(state) {
  const creation = state.glossaryCreation;
  if (!creation?.isOpen) {
    return "";
  }

  const isSubmitting = creation.status === "loading";
  const errorMarkup = creation.error
    ? `<p class="modal__error">${escapeHtml(formatErrorForDisplay(creation.error))}</p>`
    : "";
  const submitButton = loadingPrimaryButton({
    label: "Create Glossary",
    loadingLabel: "Creating...",
    action: "submit-glossary-creation",
    isLoading: isSubmitting,
  });
  const cancelButton = secondaryButton("Cancel", "cancel-glossary-creation", {
    disabled: isSubmitting,
  });

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">NEW GLOSSARY</p>
          <h2 class="modal__title">Create A New Glossary</h2>
          <p class="modal__supporting">
            This initializes a git-backed glossary in local app storage so you can start adding terms immediately.
          </p>
          <div class="modal__form">
            <label class="field">
              <span class="field__label">Glossary Name</span>
              <input
                class="field__input"
                type="text"
                placeholder="Enter glossary name"
                value="${escapeHtml(creation.title)}"
                data-glossary-title-input
                ${isSubmitting ? "disabled" : ""}
              />
            </label>
            <label class="field">
              <span class="field__label">Source Language Code</span>
              <input
                class="field__input"
                type="text"
                placeholder="es"
                value="${escapeHtml(creation.sourceLanguageCode)}"
                data-glossary-source-language-code-input
                ${isSubmitting ? "disabled" : ""}
              />
            </label>
            <label class="field">
              <span class="field__label">Source Language Name</span>
              <input
                class="field__input"
                type="text"
                placeholder="Spanish"
                value="${escapeHtml(creation.sourceLanguageName)}"
                data-glossary-source-language-name-input
                ${isSubmitting ? "disabled" : ""}
              />
            </label>
            <label class="field">
              <span class="field__label">Target Language Code</span>
              <input
                class="field__input"
                type="text"
                placeholder="en"
                value="${escapeHtml(creation.targetLanguageCode)}"
                data-glossary-target-language-code-input
                ${isSubmitting ? "disabled" : ""}
              />
            </label>
            <label class="field">
              <span class="field__label">Target Language Name</span>
              <input
                class="field__input"
                type="text"
                placeholder="English"
                value="${escapeHtml(creation.targetLanguageName)}"
                data-glossary-target-language-name-input
                ${isSubmitting ? "disabled" : ""}
              />
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
