import { escapeHtml, loadingPrimaryButton, secondaryButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";

export function renderQaListRenameModal(state) {
  const rename = state.qaListRename;
  if (!rename?.isOpen) {
    return "";
  }

  const isSubmitting = rename.status === "loading";
  const errorMarkup = rename.error
    ? `<p class="modal__error">${escapeHtml(formatErrorForDisplay(rename.error))}</p>`
    : "";

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">RENAME QA LIST</p>
          <h2 class="modal__title">Rename This QA List</h2>
          <div class="modal__form">
            <label class="field">
              <span class="field__label">QA List Name</span>
              <input
                class="field__input"
                type="text"
                placeholder="Enter QA list name"
                value="${escapeHtml(rename.qaListName)}"
                data-qa-list-rename-input
                ${isSubmitting ? "disabled" : ""}
              />
            </label>
          </div>
          ${errorMarkup}
          <div class="modal__actions">
            ${secondaryButton("Cancel", "cancel-qa-list-rename", { disabled: isSubmitting })}
            ${loadingPrimaryButton({
              label: "Rename QA List",
              loadingLabel: "Saving...",
              action: "submit-qa-list-rename",
              isLoading: isSubmitting,
            })}
          </div>
        </div>
      </section>
    </div>
  `;
}
