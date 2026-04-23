import {
  escapeHtml,
  loadingPrimaryButton,
  secondaryButton,
  tooltipAttributes,
} from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import { isoLanguageOptions } from "../lib/language-options.js";

function renderManagedLanguageRow(language, index, total, isSubmitting) {
  const code = String(language?.code ?? "").trim().toLowerCase();
  const name = String(language?.name ?? "").trim() || code;
  const label = `${name} (${code})`;
  const showRemoveButton = total > 1;
  const dragLabel = "Drag to reorder the languages shown in the editor.";
  const tooltipOptions = { align: "end" };
  const dragHandleMarkup =
    total > 1
      ? `
        <button
          class="term-variant-row__drag-handle"
          type="button"
          data-target-language-manager-handle
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
          data-action="remove-target-language-manager-language:${index}"
          aria-label="Remove language"
          ${tooltipAttributes("Remove language", tooltipOptions)}
          ${isSubmitting ? "disabled" : ""}
        ><span class="term-variant-row__remove-icon" aria-hidden="true"></span></button>
      `
    : '<span class="term-variant-row__action-spacer" aria-hidden="true"></span>';

  return `
    <div
      class="term-variant-row"
      data-target-language-manager-row
      data-language-index="${index}"
    >
      <div class="term-variant-row__shell term-variant-row__shell--disabled">
        <div class="field__input term-variant-row__input term-variant-row__input--disabled">${escapeHtml(label)}</div>
        <div class="term-variant-row__actions">
          ${dragHandleMarkup}
          ${removeButtonMarkup}
        </div>
      </div>
    </div>
  `;
}

function renderLanguagePickerModal(state) {
  const modal = state.targetLanguageManager;
  if (!modal?.isOpen || modal.isPickerOpen !== true) {
    return "";
  }

  const existingCodes = new Set(
    (Array.isArray(modal.languages) ? modal.languages : [])
      .map((language) => String(language?.code ?? "").trim().toLowerCase())
      .filter(Boolean),
  );
  const availableLanguages = isoLanguageOptions
    .filter((option) => !existingCodes.has(option.code))
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name));

  return `
    <div class="modal-backdrop modal-backdrop--nested-picker">
      <section class="card modal-card modal-card--compact modal-card--language-picker">
        <div class="card__body modal-card__body language-picker-modal">
          <p class="card__eyebrow">CHAPTER LANGUAGES</p>
          <h2 class="modal__title">Add Language</h2>
          <p class="modal__supporting">Choose a language to add to this file.</p>
          <div class="language-picker-modal__list" role="list">
            ${availableLanguages.length > 0
              ? availableLanguages.map((language) => `
                  <button
                    class="language-picker-modal__option"
                    type="button"
                    data-action="add-target-language-manager-language:${escapeHtml(language.code)}"
                  >
                    <span>${escapeHtml(language.name)}</span>
                    <span class="language-picker-modal__code">${escapeHtml(language.code)}</span>
                  </button>
                `).join("")
              : '<p class="language-picker-modal__empty">All supported languages are already in this file.</p>'}
          </div>
          <div class="modal__actions">
            ${secondaryButton("Cancel", "close-target-language-manager-picker")}
          </div>
        </div>
      </section>
    </div>
  `;
}

export function renderTargetLanguageManagerModal(state) {
  const modal = state.targetLanguageManager;
  if (!modal?.isOpen) {
    return "";
  }

  const languages = Array.isArray(modal.languages) ? modal.languages : [];
  const isSubmitting = modal.status === "loading";
  const errorMarkup = modal.error
    ? `<p class="modal__error">${escapeHtml(formatErrorForDisplay(modal.error))}</p>`
    : "";

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--glossary-term modal-card--chapter-languages">
        <div class="card__body modal-card__body glossary-term-modal chapter-language-manager-modal">
          <p class="card__eyebrow">CHAPTER LANGUAGES</p>
          <h2 class="modal__title">Add / Remove Languages</h2>
          <p class="modal__supporting">This ordered list determines which languages are shown in the editor.</p>

          <section class="term-lane">
            <div class="term-lane__rows">
              ${languages.map((language, index) =>
                renderManagedLanguageRow(language, index, languages.length, isSubmitting)).join("")}
            </div>
            <div class="term-lane__add-row">
              <button
                class="term-lane__add-button"
                type="button"
                data-action="open-target-language-manager-picker"
                aria-label="Add a new language"
                ${tooltipAttributes("Add a new language", { align: "end" })}
                ${isSubmitting ? "disabled" : ""}
              ><span class="term-lane__add-icon" aria-hidden="true"></span></button>
            </div>
          </section>

          ${errorMarkup}

          <div class="modal__actions">
            ${secondaryButton("Cancel", "close-target-language-manager", { disabled: isSubmitting })}
            ${loadingPrimaryButton({
              label: "Save",
              loadingLabel: "Saving...",
              action: "submit-target-language-manager",
              isLoading: isSubmitting,
            })}
          </div>
        </div>
      </section>
      ${renderLanguagePickerModal(state)}
    </div>
  `;
}
