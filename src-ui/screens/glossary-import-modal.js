import { escapeHtml, primaryButton, secondaryButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";

export function renderGlossaryImportModal(state) {
  const modal = state.glossaryImport;
  if (!modal?.isOpen) {
    return "";
  }

  const isImporting = modal.status === "importing";
  const errorMarkup = modal.error
    ? `<div class="project-import-modal__error-badge" role="alert">${escapeHtml(formatErrorForDisplay(modal.error))}</div>`
    : "";

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact modal-card--project-import" role="dialog" aria-modal="true" aria-labelledby="glossary-import-modal-title" data-modal-dialog="glossary-import" tabindex="-1">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">IMPORT GLOSSARY</p>
          <h2 class="modal__title" id="glossary-import-modal-title">Upload a TMX file</h2>
          <p class="modal__supporting">Import a supported glossary file into this team.</p>
          <div class="modal__form project-import-modal">
            ${errorMarkup}
            <button
              type="button"
              class="project-import-modal__drop-target glossary-import-modal__drop-target${isImporting ? " is-loading" : ""}"
              data-action="select-glossary-import-file"
              data-glossary-import-dropzone
              data-modal-initial-focus
              ${isImporting ? 'disabled aria-disabled="true"' : ""}
            >
              <span>${isImporting ? "Importing glossary; please wait." : "Drop a file here or click to open a file selector."}</span>
            </button>
            <p class="project-import-modal__hint">Supported format: .tmx.</p>
          </div>
          <div class="modal__actions">
            ${secondaryButton("Cancel", "cancel-glossary-import", {
              disabled: isImporting,
              modalCancel: true,
            })}
            ${primaryButton(isImporting ? "Importing..." : "Select File", "select-glossary-import-file", {
              disabled: isImporting,
              modalDefault: true,
            })}
          </div>
        </div>
      </section>
    </div>
  `;
}
