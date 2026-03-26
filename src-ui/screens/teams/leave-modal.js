import { escapeHtml, loadingPrimaryButton, secondaryButton } from "../../lib/ui.js";

export function renderTeamLeaveModal(state) {
  const leave = state.teamLeave;
  if (!leave?.isOpen) {
    return "";
  }

  const isLeaving = leave.status === "loading";
  const errorMarkup = leave.error
    ? `<p class="modal__error">${escapeHtml(leave.error)}</p>`
    : "";
  const leaveButton = loadingPrimaryButton({
    label: "Leave Team",
    loadingLabel: "Leaving...",
    action: "confirm-team-leave",
    isLoading: isLeaving,
  });
  const cancelButton = secondaryButton("Cancel", "cancel-team-leave", {
    disabled: isLeaving,
  });

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">LEAVE TEAM</p>
          <h2 class="modal__title">Leave This Team?</h2>
          <p class="modal__supporting">
            You will leave the GitHub organization <strong>${escapeHtml(
              leave.teamName,
            )}</strong> and it will no longer appear in Gnosis TMS for you.
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
