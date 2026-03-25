import { escapeHtml, primaryButton, secondaryButton } from "../lib/ui.js";

export function renderProjectCreationModal(state) {
  const creation = state.projectCreation;
  if (!creation?.isOpen) {
    return "";
  }

  const isSubmitting = creation.status === "loading";
  const errorMarkup = creation.error
    ? `<p class="modal__error">${escapeHtml(creation.error)}</p>`
    : "";

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">NEW PROJECT</p>
          <h2 class="modal__title">Create A New Project</h2>
          <p class="modal__supporting">
            Enter the project name. Gnosis TMS will create a new private repository and initialize it with the project storage spec.
          </p>
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
            ${secondaryButton("Cancel", "cancel-project-creation")}
            ${primaryButton(
              isSubmitting ? "Creating..." : "Create Project",
              isSubmitting ? "noop" : "submit-project-creation",
            )}
          </div>
        </div>
      </section>
    </div>
  `;
}
