import {
  escapeHtml,
  loadingPrimaryButton,
  secondaryButton,
  tooltipAttributes,
} from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import { rubyButtonConfig } from "../app/editor-inline-markup.js";
import { isGlossaryEmptyTargetVariant } from "../app/glossary-shared.js";

const EMPTY_TARGET_VARIANT_TOOLTIP =
  "Add an empty variant to indicated that it's ok to omit this word from the translation.";

function renderVariantRow(
  side,
  languageCode,
  value,
  index,
  total,
  isSubmitting,
  isRedundant = false,
) {
  const removeDisabled = isSubmitting;
  const isNoTranslationVariant =
    side === "target" && isGlossaryEmptyTargetVariant(value);
  const inputLabel = `${side === "source" ? "Source" : "Target"} variant ${index + 1}`;
  const showRemoveButton = total > 1;
  const dragLabel = "Drag to move more likely variants to the top of the list.";
  const tooltipOptions = side === "target" ? { align: "end" } : {};
  const inputClasses = ["field__input", "term-variant-row__input"];
  const shellClasses = ["term-variant-row__shell"];
  if (isRedundant) {
    inputClasses.push("term-variant-row__input--redundant");
  }
  if (isNoTranslationVariant) {
    inputClasses.push("term-variant-row__input--disabled");
    shellClasses.push("term-variant-row__shell--disabled");
  }
  const dragHandleMarkup =
    total > 1
      ? `
        <button
          class="term-variant-row__drag-handle"
          type="button"
          data-glossary-term-variant-handle
          aria-label="${escapeHtml(dragLabel)}"
          ${tooltipAttributes(dragLabel, tooltipOptions)}
          ${isSubmitting ? "disabled" : ""}
        >
          <span class="term-variant-row__drag-dots" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
            <span></span>
            <span></span>
            <span></span>
          </span>
        </button>
      `
      : '<span class="term-variant-row__drag-spacer" aria-hidden="true"></span>';
  const removeButtonMarkup = showRemoveButton
    ? `
        <button
          class="term-variant-row__action-button term-variant-row__action-button--remove"
          type="button"
          data-action="remove-glossary-term-variant:${escapeHtml(side)}:${index}"
          aria-label="Remove variant"
          ${tooltipAttributes("Remove variant", tooltipOptions)}
          ${removeDisabled ? "disabled" : ""}
        ><span class="term-variant-row__remove-icon" aria-hidden="true"></span></button>
      `
      : '<span class="term-variant-row__action-spacer" aria-hidden="true"></span>';
  const inputMarkup = isNoTranslationVariant
    ? `
        <div
          class="${inputClasses.join(" ")}"
          aria-label="${escapeHtml(inputLabel)}"
          aria-disabled="true"
        >[No translation]</div>
      `
    : `
        <textarea
          class="${inputClasses.join(" ")}"
          aria-label="${escapeHtml(inputLabel)}"
          placeholder="Enter term..."
          rows="1"
          data-glossary-term-variant-input
          data-variant-side="${escapeHtml(side)}"
          data-variant-index="${index}"
          data-language-code="${escapeHtml(languageCode)}"
          ${isSubmitting ? "disabled" : ""}
        >${escapeHtml(value)}</textarea>
      `;

  return `
    <div
      class="term-variant-row"
      data-glossary-term-variant-row
      data-variant-side="${escapeHtml(side)}"
      data-variant-index="${index}"
    >
      <div class="${shellClasses.join(" ")}">
        ${inputMarkup}
        <div class="term-variant-row__actions">
          ${dragHandleMarkup}
          ${removeButtonMarkup}
        </div>
      </div>
    </div>
  `;
}

function renderVariantLane(
  side,
  languageName,
  languageCode,
  values,
  isSubmitting,
  redundantIndices = new Set(),
) {
  const tooltipOptions = side === "target" ? { align: "end" } : {};
  const rubyConfig = rubyButtonConfig(languageCode);
  const hasEmptyTargetVariant =
    side === "target" && values.some((value) => isGlossaryEmptyTargetVariant(value));
  const emptyVariantButtonMarkup = side === "target"
    ? `
        <button
          class="term-lane__add-button term-lane__add-button--no-translation"
          type="button"
          data-action="add-glossary-term-empty-variant:target"
          aria-label="${escapeHtml(EMPTY_TARGET_VARIANT_TOOLTIP)}"
          ${tooltipAttributes(EMPTY_TARGET_VARIANT_TOOLTIP, tooltipOptions)}
          ${isSubmitting || hasEmptyTargetVariant ? "disabled" : ""}
        ><span class="term-lane__no-translation-icon" aria-hidden="true">⊘</span></button>
      `
    : "";

  return `
    <section class="term-lane">
      <div class="term-lane__header">
        <h3 class="term-lane__title">${escapeHtml(languageName)}</h3>
      </div>
      <div class="term-lane__rows">
        ${values
          .map((value, index) =>
            renderVariantRow(
              side,
              languageCode,
              value,
              index,
              values.length,
              isSubmitting,
              side === "source" && redundantIndices.has(index),
            ),
          )
          .join("")}
      </div>
      <div class="term-lane__add-row">
        <button
          class="term-lane__add-button term-lane__inline-style-button"
          type="button"
          data-action="toggle-glossary-term-inline-style:ruby:${escapeHtml(side)}"
          data-glossary-inline-style-button
          data-inline-style="ruby"
          data-variant-side="${escapeHtml(side)}"
          aria-label="${escapeHtml(rubyConfig.tooltip)}"
          aria-disabled="true"
          aria-pressed="false"
          tabindex="-1"
          ${tooltipAttributes(rubyConfig.tooltip, tooltipOptions)}
        ><span class="term-lane__inline-style-button-label" aria-hidden="true">${escapeHtml(rubyConfig.label)}</span></button>
        ${emptyVariantButtonMarkup}
        <button
          class="term-lane__add-button"
          type="button"
          data-action="add-glossary-term-variant:${escapeHtml(side)}"
          aria-label="Add variant"
          ${tooltipAttributes("Add variant", tooltipOptions)}
          ${isSubmitting ? "disabled" : ""}
        ><span class="term-lane__add-icon" aria-hidden="true"></span></button>
      </div>
    </section>
  `;
}

export function renderGlossaryTermEditorModal(state) {
  const editor = state.glossaryTermEditor;
  if (!editor?.isOpen) {
    return "";
  }

  const isSubmitting = editor.status === "loading";
  const cancelButton = secondaryButton("Cancel", "cancel-glossary-term-editor", {
    disabled: isSubmitting,
  });
  const sourceLanguageName = state.glossaryEditor?.sourceLanguage?.name ?? "Source";
  const sourceLanguageCode = state.glossaryEditor?.sourceLanguage?.code ?? "";
  const targetLanguageName = state.glossaryEditor?.targetLanguage?.name ?? "Target";
  const targetLanguageCode = state.glossaryEditor?.targetLanguage?.code ?? "";
  const noticeMarkup = editor.notice
    ? `<p class="glossary-term-modal__notice" role="alert">${escapeHtml(editor.notice)}</p>`
    : "";
  const redundantSourceVariantIndices = new Set(editor.redundantSourceVariantIndices ?? []);
  const duplicateWarningMarkup = `
    <p
      class="glossary-term-modal__warning"
      data-glossary-term-duplicate-warning
      ${editor.sourceTermDuplicateWarning ? "" : "hidden"}
    >${escapeHtml(editor.sourceTermDuplicateWarning ?? "")}</p>
  `;
  const errorMarkup = editor.error
    ? `<p class="modal__error">${escapeHtml(formatErrorForDisplay(editor.error))}</p>`
    : "";
  const submitButton = loadingPrimaryButton({
    label: editor.termId ? "Save Term" : "Add Term",
    loadingLabel: "Saving...",
    action: "submit-glossary-term-editor",
    isLoading: isSubmitting,
  });

  return `
    <div class="modal-backdrop modal-backdrop--glossary-term">
      <section class="card modal-card modal-card--glossary-term">
        <div class="card__body modal-card__body glossary-term-modal">
          <h2 class="modal__title">${editor.termId ? "Edit Term" : "New Term"}</h2>
          ${noticeMarkup}
          ${duplicateWarningMarkup}

          <div class="glossary-term-modal__lanes">
            ${renderVariantLane(
              "source",
              sourceLanguageName,
              sourceLanguageCode,
              editor.sourceTerms,
              isSubmitting,
              redundantSourceVariantIndices,
            )}
            ${renderVariantLane(
              "target",
              targetLanguageName,
              targetLanguageCode,
              editor.targetTerms,
              isSubmitting,
            )}
          </div>

          <section class="glossary-term-modal__details">
            <div class="glossary-term-modal__details-grid">
              <label class="field">
                <span class="field__label">Notes</span>
                <textarea class="field__textarea" placeholder="Enter instructions for how this term should be translated here." data-glossary-term-notes-input ${isSubmitting ? "disabled" : ""}>${escapeHtml(editor.notesToTranslators)}</textarea>
              </label>
              <label class="field">
                <span class="field__label">Footnote</span>
                <textarea class="field__textarea" placeholder="Enter suggested footnote text here." data-glossary-term-footnote-input ${isSubmitting ? "disabled" : ""}>${escapeHtml(editor.footnote)}</textarea>
              </label>
            </div>
          </section>

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
