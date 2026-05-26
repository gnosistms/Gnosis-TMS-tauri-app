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
      })
    : `
      <button class="button button--primary is-disabled" data-action="noop" aria-disabled="true" disabled>
        <span>Remove</span>
      </button>
    `;
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
