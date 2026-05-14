import {
  escapeHtml,
  loadingPrimaryButton,
  secondaryButton,
  tooltipAttributes,
} from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import { rubyButtonConfig } from "../app/editor-inline-markup.js";

export function renderQaTermEditorModal(state) {
  const editor = state.qaTermEditor;
  if (!editor?.isOpen) {
    return "";
  }

  const isSubmitting = editor.status === "loading";
  const languageCode = state.qaListEditor?.language?.code ?? "";
  const languageName = state.qaListEditor?.language?.name ?? "Language";
  const rubyConfig = rubyButtonConfig(languageCode);
  const errorMarkup = editor.error
    ? `<p class="modal__error">${escapeHtml(formatErrorForDisplay(editor.error))}</p>`
    : "";

  return `
    <div class="modal-backdrop modal-backdrop--glossary-term">
      <section class="card modal-card modal-card--glossary-term">
        <div class="card__body modal-card__body glossary-term-modal">
          <h2 class="modal__title">${editor.termId ? "Edit QA Term" : "New QA Term"}</h2>
          <section class="term-lane">
            <div class="term-lane__header">
              <h3 class="term-lane__title">${escapeHtml(languageName)}</h3>
              <h3 class="term-lane__title term-lane__title--notes">Notes</h3>
            </div>
            <div class="qa-term-modal__fields">
              <textarea
                class="field__textarea"
                aria-label="QA term text"
                placeholder="Enter QA term..."
                rows="3"
                data-qa-term-text-input
                data-language-code="${escapeHtml(languageCode)}"
                ${isSubmitting ? "disabled" : ""}
              >${escapeHtml(editor.text)}</textarea>
              <textarea
                class="field__textarea"
                aria-label="QA term notes"
                placeholder="Notes..."
                rows="3"
                data-qa-term-notes-input
                ${isSubmitting ? "disabled" : ""}
              >${escapeHtml(editor.notes)}</textarea>
            </div>
            <div class="term-lane__add-row">
              <button
                class="term-lane__add-button term-lane__inline-style-button"
                type="button"
                data-action="toggle-qa-term-inline-style:ruby"
                data-qa-term-inline-style-button
                data-inline-style="ruby"
                aria-label="${escapeHtml(rubyConfig.tooltip)}"
                aria-disabled="true"
                aria-pressed="false"
                tabindex="-1"
                ${tooltipAttributes(rubyConfig.tooltip)}
              ><span class="term-lane__inline-style-button-label" aria-hidden="true">${escapeHtml(rubyConfig.label)}</span></button>
            </div>
          </section>
          ${errorMarkup}
          <div class="modal__actions">
            ${secondaryButton("Cancel", "cancel-qa-term-editor", { disabled: isSubmitting })}
            ${loadingPrimaryButton({
              label: editor.termId ? "Save QA Term" : "Add QA Term",
              loadingLabel: "Saving...",
              action: "submit-qa-term-editor",
              isLoading: isSubmitting,
            })}
          </div>
        </div>
      </section>
    </div>
  `;
}
