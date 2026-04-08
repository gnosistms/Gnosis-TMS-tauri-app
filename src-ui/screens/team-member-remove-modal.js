import { escapeHtml, loadingPrimaryButton, secondaryButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";

export function renderTeamMemberRemoveModal(state) {
  const removal = state.teamMemberRemoval;
  if (!removal?.isOpen) {
    return "";
  }

  const isRemoving = removal.status === "loading";
  const errorMarkup = removal.error
    ? `<p class="modal__error">${escapeHtml(formatErrorForDisplay(removal.error))}</p>`
    : "";
  const removeButton = loadingPrimaryButton({
    label: "Remove",
    loadingLabel: "Removing...",
    action: "confirm-team-member-removal",
    isLoading: isRemoving,
  });
  const cancelButton = secondaryButton("Cancel", "cancel-team-member-removal", {
    disabled: isRemoving,
  });

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">${escapeHtml(removal.teamName)}</p>
          <h2 class="modal__title">Remove this member?</h2>
          <p class="modal__supporting">
            Remove @${escapeHtml(removal.username)} from this team? They will lose access until the team owner invites them again.
          </p>
          ${errorMarkup}
          <div class="modal__actions">
            ${cancelButton}
            ${removeButton}
          </div>
        </div>
      </section>
    </div>
  `;
}
