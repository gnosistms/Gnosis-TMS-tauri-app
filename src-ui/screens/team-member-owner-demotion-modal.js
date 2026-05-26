import { escapeHtml, loadingPrimaryButton, secondaryButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import { normalizedConfirmationValue } from "../app/resource-entity-modal.js";

export function renderTeamMemberOwnerDemotionModal(state) {
  const demotion = state.teamMemberOwnerDemotion;
  if (!demotion?.isOpen) {
    return "";
  }

  const isSubmitting = demotion.status === "loading";
  const confirmationMatches =
    normalizedConfirmationValue(demotion.confirmationText)
    === normalizedConfirmationValue(demotion.username);
  const errorMarkup = demotion.error
    ? `<p class="modal__error">${escapeHtml(formatErrorForDisplay(demotion.error))}</p>`
    : "";
  const continueButton = confirmationMatches
    ? loadingPrimaryButton({
        label: "Change role",
        loadingLabel: "Changing...",
        action: "confirm-team-member-owner-demotion",
        isLoading: isSubmitting,
      })
    : `
      <button class="button button--primary is-disabled" data-action="noop" aria-disabled="true" disabled>
        <span>Change role</span>
      </button>
    `;
  const cancelButton = secondaryButton("Cancel", "cancel-team-member-owner-demotion", {
    disabled: isSubmitting,
  });

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">CHANGE OWNER ROLE</p>
          <h2 class="modal__title">Change @${escapeHtml(demotion.username)} to ${escapeHtml(demotion.targetRole)}?</h2>
          <p class="modal__supporting">
            This removes Owner access for @${escapeHtml(demotion.username)}. Type ${escapeHtml(demotion.username)} to confirm this change.
          </p>
          <label class="field">
            <span class="field__label">GitHub username</span>
            <input
              class="field__input"
              type="text"
              value="${escapeHtml(demotion.confirmationText)}"
              placeholder="${escapeHtml(demotion.username)}"
              data-team-member-owner-demotion-confirmation-input
              ${isSubmitting ? "disabled" : ""}
            />
          </label>
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
