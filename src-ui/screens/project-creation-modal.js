import { escapeHtml, loadingPrimaryButton, secondaryButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";

export function renderProjectCreationModal(state) {
  const creation = state.projectCreation;
  if (!creation?.isOpen) {
    return "";
  }

  const isSubmitting = creation.status === "loading";
  const errorMarkup = creation.error
    ? `<p class="modal__error">${escapeHtml(formatErrorForDisplay(creation.error))}</p>`
    : "";
  const submitButton = loadingPrimaryButton({
    label: "Create Project",
    loadingLabel: "Creating...",
    action: "submit-project-creation",
    isLoading: isSubmitting,
  });
  const cancelButton = secondaryButton("Cancel", "cancel-project-creation", {
    disabled: isSubmitting,
  });

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">NEW PROJECT</p>
          <h2 class="modal__title">Create A New Project</h2>
          <div class="modal__form">
            <label class="field">
              <span class="field__label">Project Name</span>
              <input
                class="field__input"
                type="text"
                placeholder="Enter project name"
                value="${escapeHtml(creation.projectName)}"
                data-project-name-input
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
