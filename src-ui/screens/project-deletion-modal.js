import { escapeHtml, secondaryButton } from "../lib/ui.js";

export function renderProjectDeletionModal(state) {
  const deletion = state.projectDeletion;
  if (!deletion?.isOpen) {
    return "";
  }

  const isDeleting = deletion.status === "loading";
  const errorMarkup = deletion.error
    ? `<p class="modal__error">${escapeHtml(deletion.error)}</p>`
    : "";
  const deleteButton = isDeleting
    ? `
      <button class="button button--primary" data-action="noop" disabled>
        <span class="button__spinner" aria-hidden="true"></span>
        <span>Deleting...</span>
      </button>
    `
    : `
      <button class="button button--primary" data-action="confirm-project-deletion">
        <span>Delete</span>
      </button>
    `;

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">DELETE PROJECT</p>
          <h2 class="modal__title">Remove This Project?</h2>
          <p class="modal__supporting">
            "${escapeHtml(deletion.projectName)}" will be hidden from the Projects page, but the repository will stay on GitHub and can be restored later.
          </p>
          ${errorMarkup}
          <div class="modal__actions">
            ${secondaryButton("Cancel", "cancel-project-deletion")}
            ${deleteButton}
          </div>
        </div>
      </section>
    </div>
  `;
}
