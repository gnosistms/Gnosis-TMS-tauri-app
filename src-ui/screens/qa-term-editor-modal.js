import {
  escapeHtml,
  loadingPrimaryButton,
  secondaryButton,
  tooltipAttributes,
} from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import { rubyButtonConfig } from "../app/editor-inline-markup.js";

const QA_CASE_SENSITIVE_TOOLTIP =
  'When checked, the term found in the translation text must exactly match the case of the text entered above. For example, "text" will not match "Text" when this is checked.';
const QA_REGULAR_EXPRESSION_TOOLTIP =
  "check this to match the term to the translation text using regular expression search rather than plain text.";

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
      <section class="card modal-card modal-card--glossary-term" role="dialog" aria-modal="true" aria-labelledby="qa-term-editor-modal-title" data-modal-dialog="qa-term-editor" tabindex="-1">
        <div class="card__body modal-card__body glossary-term-modal">
          <h2 class="modal__title" id="qa-term-editor-modal-title">${editor.termId ? "Edit QA Term" : "New QA Term"}</h2>
          <section class="term-lane">
            <div class="term-lane__header">
              <h3 class="term-lane__title">${escapeHtml(languageName)}</h3>
              <h3 class="term-lane__title term-lane__title--notes">Notes</h3>
            </div>
            <div class="qa-term-modal__fields">
              <div class="qa-term-modal__term-field">
                <textarea
                  class="field__textarea"
                  aria-label="QA term text"
                  placeholder="Enter QA term..."
                  rows="3"
                  data-qa-term-text-input
                  data-modal-initial-focus
                  data-language-code="${escapeHtml(languageCode)}"
                  ${isSubmitting ? "disabled" : ""}
                >${escapeHtml(editor.text)}</textarea>
                <label class="field__checkbox"${tooltipAttributes(QA_CASE_SENSITIVE_TOOLTIP)}>
                  <input
                    type="checkbox"
                    data-qa-term-case-sensitive-input
                    ${editor.isCaseSensitive === true ? "checked" : ""}
                    ${isSubmitting ? "disabled" : ""}
                  />
                  <span>case sensitive</span>
                </label>
                <label class="field__checkbox"${tooltipAttributes(QA_REGULAR_EXPRESSION_TOOLTIP)}>
                  <input
                    type="checkbox"
                    data-qa-term-regular-expression-input
                    ${editor.isRegularExpression === true ? "checked" : ""}
                    ${isSubmitting ? "disabled" : ""}
                  />
                  <span>regular expression</span>
                </label>
              </div>
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
            ${secondaryButton("Cancel", "cancel-qa-term-editor", {
              disabled: isSubmitting,
              modalCancel: true,
            })}
            ${loadingPrimaryButton({
              label: editor.termId ? "Save QA Term" : "Add QA Term",
              loadingLabel: "Saving...",
              action: "submit-qa-term-editor",
              isLoading: isSubmitting,
              modalDefault: true,
            })}
          </div>
        </div>
      </section>
    </div>
  `;
}
