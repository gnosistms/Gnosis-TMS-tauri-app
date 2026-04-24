import { escapeHtml, primaryButton, secondaryButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";

export function renderProjectImportModal(state) {
  const modal = state.projectImport;
  if (!modal?.isOpen) {
    return "";
  }

  const isImporting = modal.status === "importing";
  const projectTitle = String(modal.projectTitle ?? "").trim() || "this project";
  const errorMarkup = modal.error
    ? `<div class="project-import-modal__error-badge" role="alert">${escapeHtml(formatErrorForDisplay(modal.error))}</div>`
    : "";

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact modal-card--project-import">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">ADD FILE</p>
          <h2 class="modal__title">Upload a file</h2>
          <p class="modal__supporting">Add a supported file to ${escapeHtml(projectTitle)}.</p>
          <div class="modal__form project-import-modal">
            ${errorMarkup}
            <button
              type="button"
              class="project-import-modal__drop-target${isImporting ? " is-loading" : ""}"
              data-action="select-project-import-file"
              data-project-import-dropzone
              ${isImporting ? 'disabled aria-disabled="true"' : ""}
            >
              ${isImporting ? '<span class="button__spinner" aria-hidden="true"></span>' : ""}
              <span>Drop a file here or click to open a file selector.</span>
            </button>
            <p class="project-import-modal__hint">Supported format: .xlsx. The first row must contain valid ISO 639-1 two-letter language codes such as es, en, or vi.</p>
          </div>
          <div class="modal__actions">
            ${secondaryButton("Cancel", "cancel-project-import", { disabled: isImporting })}
            ${primaryButton(isImporting ? "Uploading..." : "Select File", "select-project-import-file", { disabled: isImporting })}
          </div>
        </div>
      </section>
    </div>
  `;
}
