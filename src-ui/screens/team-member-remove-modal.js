import { escapeHtml, loadingPrimaryButton, secondaryButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import { normalizedConfirmationValue } from "../app/resource-entity-modal.js";

export function renderTeamMemberRemoveModal(state) {
  const removal = state.teamMemberRemoval;
  if (!removal?.isOpen) {
    return "";
  }

  const isRemoving = removal.status === "loading";
  const requiresConfirmation = removal.requiresConfirmation === true;
  const confirmationMatches =
    !requiresConfirmation
    || normalizedConfirmationValue(removal.confirmationText)
      === normalizedConfirmationValue(removal.username);
  const errorMarkup = removal.error
    ? `<p class="modal__error">${escapeHtml(formatErrorForDisplay(removal.error))}</p>`
    : "";
  const removeButton = confirmationMatches
    ? loadingPrimaryButton({
        label: "Remove",
        loadingLabel: "Removing...",
        action: "confirm-team-member-removal",
        isLoading: isRemoving,
        modalDefault: requiresConfirmation,
      })
    : `
      <button class="button button--primary is-disabled" data-action="noop" aria-disabled="true" disabled>
        <span>Remove</span>
      </button>
    `;
  const cancelButton = secondaryButton("Cancel", "cancel-team-member-removal", {
    disabled: isRemoving,
    modalCancel: true,
    modalInitialFocus: !requiresConfirmation,
  });

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact" role="dialog" aria-modal="true" aria-labelledby="team-member-removal-modal-title" data-modal-dialog="team-member-removal" tabindex="-1">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">${escapeHtml(removal.teamName)}</p>
          <h2 class="modal__title" id="team-member-removal-modal-title">Remove this member?</h2>
          <p class="modal__supporting">
            Remove @${escapeHtml(removal.username)} from this team? They will lose access until the team owner invites them again.
          </p>
          ${
            requiresConfirmation
              ? `
                <label class="field">
                  <span class="field__label">GitHub username</span>
                  <input
                    class="field__input"
                    type="text"
                    value="${escapeHtml(removal.confirmationText)}"
                    placeholder="${escapeHtml(removal.username)}"
                    data-team-member-removal-confirmation-input
                    data-modal-initial-focus
                    ${isRemoving ? "disabled" : ""}
                  />
                </label>
              `
              : ""
          }
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
