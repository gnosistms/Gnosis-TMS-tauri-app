import { escapeHtml, loadingPrimaryButton, secondaryButton } from "../../lib/ui.js";
import { formatErrorForDisplay } from "../../app/error-display.js";

export function renderTeamRenameModal(state) {
  const rename = state.teamRename;
  if (!rename?.isOpen) {
    return "";
  }

  const isSubmitting = rename.status === "loading";
  const errorMarkup = rename.error
    ? `<p class="modal__error">${escapeHtml(formatErrorForDisplay(rename.error))}</p>`
    : "";
  const submitButton = loadingPrimaryButton({
    label: "Rename Team",
    loadingLabel: "Saving...",
    action: "submit-team-rename",
    isLoading: isSubmitting,
    modalDefault: true,
  });
  const cancelButton = secondaryButton("Cancel", "cancel-team-rename", {
    disabled: isSubmitting,
    modalCancel: true,
  });

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact" role="dialog" aria-modal="true" aria-labelledby="team-rename-modal-title" data-modal-dialog="team-rename" tabindex="-1">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">RENAME TEAM</p>
          <h2 class="modal__title" id="team-rename-modal-title">Rename This Team</h2>
          <p class="modal__supporting">
            This changes the team name shown in Gnosis TMS. It does not change the team's GitHub address.
          </p>
          <div class="modal__form">
            <label class="field">
              <span class="field__label">Team Name</span>
              <input
                class="field__input"
                type="text"
                placeholder="Enter team name"
                value="${escapeHtml(rename.teamName)}"
                data-team-rename-input
                data-modal-initial-focus
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
