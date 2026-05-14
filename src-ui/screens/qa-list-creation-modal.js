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

export function renderQaListCreationModal(state) {
  const creation = state.qaListCreation;
  if (!creation?.isOpen) {
    return "";
  }

  const isSubmitting = creation.status === "loading";
  const errorMarkup = creation.error
    ? `<p class="modal__error">${escapeHtml(formatErrorForDisplay(creation.error))}</p>`
    : "";

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">NEW QA LIST</p>
          <h2 class="modal__title">Create A New QA List</h2>
          <div class="modal__form">
            <label class="field">
              <span class="field__label">QA List Name</span>
              <input
                class="field__input"
                type="text"
                placeholder="Enter QA list name"
                value="${escapeHtml(creation.title)}"
                data-qa-list-title-input
                ${isSubmitting ? "disabled" : ""}
              />
            </label>
            <label class="field">
              <span class="field__label">Language</span>
              <select
                class="field__select"
                data-qa-list-language-select
                ${isSubmitting ? "disabled" : ""}
              >
                ${renderLanguageOptions(creation.languageCode)}
              </select>
            </label>
          </div>
          ${errorMarkup}
          <div class="modal__actions">
            ${secondaryButton("Cancel", "cancel-qa-list-creation", { disabled: isSubmitting })}
            ${loadingPrimaryButton({
              label: "Create QA List",
              loadingLabel: "Creating...",
              action: "submit-qa-list-creation",
              isLoading: isSubmitting,
            })}
          </div>
        </div>
      </section>
    </div>
  `;
}
