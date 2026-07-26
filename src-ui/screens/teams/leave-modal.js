import { escapeHtml, loadingPrimaryButton, secondaryButton } from "../../lib/ui.js";
import { formatErrorForDisplay } from "../../app/error-display.js";

export function renderTeamLeaveModal(state) {
  const leave = state.teamLeave;
  if (!leave?.isOpen) {
    return "";
  }

  const isLeaving = leave.status === "loading";
  const errorMarkup = leave.error
    ? `<p class="modal__error">${escapeHtml(formatErrorForDisplay(leave.error))}</p>`
    : "";
  const leaveButton = loadingPrimaryButton({
    label: "Leave",
    loadingLabel: "Leaving...",
    action: "confirm-team-leave",
    isLoading: isLeaving,
  });
  const cancelButton = secondaryButton("Cancel", "cancel-team-leave", {
    disabled: isLeaving,
    modalCancel: true,
    modalInitialFocus: true,
  });

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact" role="dialog" aria-modal="true" aria-labelledby="team-leave-modal-title" data-modal-dialog="team-leave" tabindex="-1">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">${escapeHtml(leave.teamName)}</p>
          <h2 class="modal__title" id="team-leave-modal-title">Leave this team?</h2>
          <p class="modal__supporting">
            Do you want to leave this team? Once you leave, only the team owner can add you back.
          </p>
          ${errorMarkup}
          <div class="modal__actions">
            ${cancelButton}
            ${leaveButton}
          </div>
        </div>
      </section>
    </div>
  `;
}
