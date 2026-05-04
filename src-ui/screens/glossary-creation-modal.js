import { escapeHtml, loadingPrimaryButton, secondaryButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import { findIsoLanguageOption, isoLanguageOptions } from "../lib/language-options.js";

function renderLanguageOptions(selectedCode) {
  const canonicalSelectedCode = findIsoLanguageOption(selectedCode)?.code ?? "";
  return [
    `<option value="">Select a language</option>`,
    ...isoLanguageOptions.map(
      (language) => `
        <option value="${escapeHtml(language.code)}" ${language.code === canonicalSelectedCode ? "selected" : ""}>
          ${escapeHtml(`${language.name} (${language.code})`)}
        </option>
      `,
    ),
  ].join("");
}

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
            This creates a glossary repository for this team and initializes its <strong>glossary.json</strong> so you can start adding terms immediately.
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
              <span class="field__label">Source Language</span>
              <select
                class="field__select"
                data-glossary-source-language-select
                ${isSubmitting ? "disabled" : ""}
              >
                ${renderLanguageOptions(creation.sourceLanguageCode)}
              </select>
            </label>
            <label class="field">
              <span class="field__label">Target Language</span>
              <select
                class="field__select"
                data-glossary-target-language-select
                ${isSubmitting ? "disabled" : ""}
              >
                ${renderLanguageOptions(creation.targetLanguageCode)}
              </select>
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
