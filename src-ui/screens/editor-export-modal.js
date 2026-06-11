import {
  escapeHtml,
  loadingPrimaryButton,
  renderCollapseChevron,
  secondaryButton,
} from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import {
  EDITOR_EXPORT_CATEGORIES,
  findEditorExportOption,
} from "../app/editor-export-flow.js";

function renderExportOption(option, selectedOptionId) {
  const classes = [
    "editor-export-modal__option",
    option.id === selectedOptionId ? "is-selected" : "",
  ].filter(Boolean).join(" ");
  return `
    <li>
      <button
        type="button"
        class="${classes}"
        data-action="select-editor-export-option:${escapeHtml(option.id)}"
        aria-pressed="${option.id === selectedOptionId ? "true" : "false"}"
      >${escapeHtml(option.label)}</button>
    </li>
  `;
}

function renderExportCategory(category, modal) {
  const expanded = Array.isArray(modal.expandedCategoryIds)
    && modal.expandedCategoryIds.includes(category.id);
  const optionsMarkup = expanded
    ? `<ul class="editor-export-modal__options">${category.options
      .map((option) => renderExportOption(option, modal.selectedOptionId))
      .join("")}</ul>`
    : "";

  return `
    <div class="editor-export-modal__category">
      <button
        type="button"
        class="editor-export-modal__category-toggle"
        data-action="toggle-editor-export-category:${escapeHtml(category.id)}"
        aria-expanded="${expanded ? "true" : "false"}"
      >
        ${renderCollapseChevron(expanded, "editor-export-modal__chevron")}
        <span>${escapeHtml(category.label)}</span>
      </button>
      ${optionsMarkup}
    </div>
  `;
}

function exportDetail(option, isExporting) {
  if (!option || option.available !== true) {
    return {
      text: "This export option is not available yet.",
      submitButton: "",
    };
  }

  if (option.kind === "file") {
    return {
      text: `Click Save to export a ${option.label} file.`,
      submitButton: loadingPrimaryButton({
        label: "Save",
        loadingLabel: "Saving...",
        action: "submit-editor-export",
        isLoading: isExporting,
      }),
    };
  }

  return {
    text: `Click Copy to export ${option.label.toLowerCase()} data to the clipboard for pasting into other apps.`,
    submitButton: loadingPrimaryButton({
      label: "Copy",
      loadingLabel: "Copying...",
      action: "submit-editor-export",
      isLoading: isExporting,
    }),
  };
}

export function renderEditorExportModal(state) {
  const modal = state.editorChapter?.exportModal;
  if (!modal?.isOpen) {
    return "";
  }

  const isExporting = modal.status === "exporting";
  const option = findEditorExportOption(modal.selectedOptionId);
  const detail = exportDetail(option, isExporting);
  const errorMarkup = modal.error
    ? `<p class="modal__error" role="alert">${escapeHtml(formatErrorForDisplay(modal.error))}</p>`
    : "";

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--editor-export">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">Export</p>
          <h2 class="modal__title">Export options</h2>
          <div class="editor-export-modal">
            <nav class="editor-export-modal__nav" aria-label="Export options">
              ${EDITOR_EXPORT_CATEGORIES.map((category) => renderExportCategory(category, modal)).join("")}
            </nav>
            <div class="editor-export-modal__detail">
              <p class="editor-export-modal__detail-heading">${escapeHtml(option?.label ?? "")}</p>
              <p class="modal__supporting">${escapeHtml(detail.text)}</p>
              ${errorMarkup}
              <div class="modal__actions">
                ${secondaryButton("Cancel", "close-editor-export-options", { disabled: isExporting })}
                ${detail.submitButton}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  `;
}
