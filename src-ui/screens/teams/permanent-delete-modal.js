import { escapeHtml, loadingPrimaryButton, secondaryButton } from "../../lib/ui.js";

export function renderTeamPermanentDeletionModal(state) {
  const deletion = state.teamPermanentDeletion;
  if (!deletion?.isOpen) {
    return "";
  }

  const isDeleting = deletion.status === "loading";
  const matchesName = deletion.confirmationText === deletion.teamName;
  const errorMarkup = deletion.error
    ? `<p class="modal__error">${escapeHtml(deletion.error)}</p>`
    : "";
  const deleteButton = isDeleting
    ? loadingPrimaryButton({
        label: "Delete",
        loadingLabel: "Deleting...",
        action: "confirm-team-permanent-deletion",
        isLoading: true,
      })
    : `<button class="button button--primary" data-action="confirm-team-permanent-deletion" data-team-permanent-delete-button ${
        matchesName ? "" : "disabled"
      }>Delete</button>`;
  const cancelButton = secondaryButton("Cancel", "cancel-team-permanent-deletion", {
    disabled: isDeleting,
  });

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">PERMANENT DELETE</p>
          <h2 class="modal__title">Permanently Delete Team?</h2>
          <p class="modal__supporting">
            To permanently delete this team, type <strong>${escapeHtml(
              deletion.teamName,
            )}</strong> in the text box below. Then click Delete. This will permanently delete the GitHub organization and all of its repositories. This action can not be undone.
          </p>
          <div class="modal__form">
            <label class="field">
              <span class="field__label">Team Name</span>
              <input
                class="field__input"
                type="text"
                placeholder="Enter team name here to delete"
                value="${escapeHtml(deletion.confirmationText)}"
                data-team-permanent-delete-input
                ${isDeleting ? "disabled" : ""}
              />
            </label>
          </div>
          ${errorMarkup}
          <div class="modal__actions">
            ${cancelButton}
            ${deleteButton}
          </div>
        </div>
      </section>
    </div>
  `;
}
