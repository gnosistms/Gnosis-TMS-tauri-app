import { escapeHtml, loadingPrimaryButton, secondaryButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";

export function renderTeamMemberOwnerModal(state) {
  const promotion = state.teamMemberOwnerPromotion;
  if (!promotion?.isOpen) {
    return "";
  }

  const isPromoting = promotion.status === "loading";
  const errorMarkup = promotion.error
    ? `<p class="modal__error">${escapeHtml(formatErrorForDisplay(promotion.error))}</p>`
    : "";
  const continueButton = loadingPrimaryButton({
    label: "Continue",
    loadingLabel: "Promoting...",
    action: "confirm-team-member-owner-promotion",
    isLoading: isPromoting,
  });
  const cancelButton = secondaryButton("Cancel", "cancel-team-member-owner-promotion", {
    disabled: isPromoting,
  });

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">MAKE OWNER</p>
          <h2 class="modal__title">Promote this user to co-owner of the team?</h2>
          <p class="modal__supporting">
            GitHub recommends having two owners on each team so that you don't lose access if one of the owners is unable to log in. However, you should know that when you promote another user to the owner role, they will have the same permissions as you do, including the ability to delete the team.
          </p>
          ${errorMarkup}
          <div class="modal__actions">
            ${cancelButton}
            ${continueButton}
          </div>
        </div>
      </section>
    </div>
  `;
}
