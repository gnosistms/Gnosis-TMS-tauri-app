import {
  escapeHtml,
  primaryButton,
  renderSelectPillControl,
  secondaryButton,
} from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";

const SUPPORTED_FORMATS = ["xlsx", "docx", "txt", "html", "srt"];
const LANGUAGE_FORMATS = new Set(["docx", "txt", "html"]);

function formatLabel(format) {
  return String(format ?? "").trim().toUpperCase();
}

function renderFormatSelect(modal) {
  const format = String(modal?.format ?? "").trim().toLowerCase();
  return renderSelectPillControl({
    label: "File format",
    value: format ? formatLabel(format) : "Select",
    className: "select-pill--modal",
    selectAttributes: {
      "data-project-export-format-select": true,
      "aria-label": "File format",
    },
    options: [
      {
        value: "",
        label: "Select",
        selected: !format,
      },
      ...SUPPORTED_FORMATS.map((option) => ({
        value: option,
        label: formatLabel(option),
        selected: option === format,
      })),
    ],
  });
}

function renderLanguageSelect(modal) {
  const format = String(modal?.format ?? "").trim().toLowerCase();
  if (!LANGUAGE_FORMATS.has(format)) {
    return "";
  }

  const languageCode = String(modal?.languageCode ?? "").trim();
  const languages = Array.isArray(modal?.languages) ? modal.languages : [];
  const selectedLanguage = languages.find((language) => language?.code === languageCode) ?? null;
  const selectedLabel = selectedLanguage
    ? `${selectedLanguage.name || selectedLanguage.code} (${selectedLanguage.code})`
    : "Select";

  return renderSelectPillControl({
    label: "Export language",
    value: selectedLabel,
    className: "select-pill--modal",
    selectAttributes: {
      "data-project-export-language-select": true,
      "aria-label": "Export language",
    },
    options: [
      {
        value: "",
        label: "Select",
        selected: !languageCode,
      },
      ...languages.map((language) => {
        const code = String(language?.code ?? "").trim();
        const label = `${language?.name || code} (${code})`;
        return {
          value: code,
          label,
          selected: code === languageCode,
        };
      }),
    ],
  });
}

function renderUnsupportedModal(modal) {
  if (!modal?.unsupportedFormat) {
    return "";
  }

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">Unsupported function</p>
          <h2 class="modal__title">This feature is not implemented yet.</h2>
          <p class="modal__supporting">Contact the developers if you need this feature and ask them to implement it.</p>
          <div class="modal__actions">
            ${primaryButton("Ok", "close-project-export-unsupported")}
          </div>
        </div>
      </section>
    </div>
  `;
}

export function renderProjectExportModal(state) {
  const modal = state.projectExport;
  if (!modal?.isOpen) {
    return "";
  }

  const unsupportedMarkup = renderUnsupportedModal(modal);
  if (unsupportedMarkup) {
    return unsupportedMarkup;
  }

  const format = String(modal.format ?? "").trim().toLowerCase();
  const requiresLanguage = LANGUAGE_FORMATS.has(format);
  const isExporting = modal.status === "exporting";
  const canSave = Boolean(format) && (!requiresLanguage || Boolean(String(modal.languageCode ?? "").trim()));
  const errorMarkup = modal.error
    ? `<p class="modal__error" role="alert">${escapeHtml(formatErrorForDisplay(modal.error))}</p>`
    : "";

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">Export</p>
          <h2 class="modal__title">Select file format</h2>
          <div class="modal__form project-export-modal">
            ${errorMarkup}
            ${renderFormatSelect(modal)}
            ${renderLanguageSelect(modal)}
          </div>
          <div class="modal__actions">
            ${secondaryButton("Cancel", "cancel-project-export", { disabled: isExporting })}
            ${primaryButton(isExporting ? "Saving..." : "Save", "submit-project-export", { disabled: !canSave || isExporting })}
          </div>
        </div>
      </section>
    </div>
  `;
}
