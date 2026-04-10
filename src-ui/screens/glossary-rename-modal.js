import { escapeHtml, loadingPrimaryButton, secondaryButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";

export function renderGlossaryRenameModal(state) {
  const rename = state.glossaryRename;
  if (!rename?.isOpen) {
    return "";
  }

  const isSubmitting = rename.status === "loading";
  const errorMarkup = rename.error
    ? `<p class="modal__error">${escapeHtml(formatErrorForDisplay(rename.error))}</p>`
    : "";
  const submitButton = loadingPrimaryButton({
    label: "Rename Glossary",
    loadingLabel: "Saving...",
    action: "submit-glossary-rename",
    isLoading: isSubmitting,
  });
  const cancelButton = secondaryButton("Cancel", "cancel-glossary-rename", {
    disabled: isSubmitting,
  });

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">RENAME GLOSSARY</p>
          <h2 class="modal__title">Rename This Glossary</h2>
          <div class="modal__form">
            <label class="field">
              <span class="field__label">Glossary Name</span>
              <input
                class="field__input"
                type="text"
                placeholder="Enter glossary name"
                value="${escapeHtml(rename.glossaryName)}"
                data-glossary-rename-input
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
