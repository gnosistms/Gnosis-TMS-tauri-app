import { escapeHtml, loadingPrimaryButton, secondaryButton } from "../../lib/ui.js";

export function renderTeamRenameModal(state) {
  const rename = state.teamRename;
  if (!rename?.isOpen) {
    return "";
  }

  const isSubmitting = rename.status === "loading";
  const errorMarkup = rename.error
    ? `<p class="modal__error">${escapeHtml(rename.error)}</p>`
    : "";
  const submitButton = loadingPrimaryButton({
    label: "Rename Team",
    loadingLabel: "Saving...",
    action: "submit-team-rename",
    isLoading: isSubmitting,
  });
  const cancelButton = secondaryButton("Cancel", "cancel-team-rename", {
    disabled: isSubmitting,
  });

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">RENAME TEAM</p>
          <h2 class="modal__title">Rename This Team</h2>
          <p class="modal__supporting">
            This changes the GitHub organization <strong>name</strong> field shown in Gnosis TMS. The GitHub slug will stay the same.
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
