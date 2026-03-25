import { escapeHtml, loadingPrimaryButton, secondaryButton } from "../lib/ui.js";

export function renderProjectRenameModal(state) {
  const rename = state.projectRename;
  if (!rename?.isOpen) {
    return "";
  }

  const isSubmitting = rename.status === "loading";
  const errorMarkup = rename.error
    ? `<p class="modal__error">${escapeHtml(rename.error)}</p>`
    : "";
  const submitButton = loadingPrimaryButton({
    label: "Rename Project",
    loadingLabel: "Saving...",
    action: "submit-project-rename",
    isLoading: isSubmitting,
  });
  const cancelButton = secondaryButton("Cancel", "cancel-project-rename", {
    disabled: isSubmitting,
  });

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">RENAME PROJECT</p>
          <h2 class="modal__title">Rename This Project</h2>
          <p class="modal__supporting">
            This changes the human-readable project title stored in <strong>project.json</strong>. The GitHub repository slug will stay the same.
          </p>
          <div class="modal__form">
            <label class="field">
              <span class="field__label">Project Name</span>
              <input
                class="field__input"
                type="text"
                placeholder="Enter project name"
                value="${escapeHtml(rename.projectName)}"
                data-project-rename-input
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
