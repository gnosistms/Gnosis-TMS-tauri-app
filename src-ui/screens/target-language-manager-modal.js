import {
  escapeHtml,
  loadingPrimaryButton,
  primaryButton,
  secondaryButton,
  tooltipAttributes,
} from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import { findIsoLanguageOption, isoLanguageOptions } from "../lib/language-options.js";
import { languageBaseCode, languageDisplayName } from "../app/editor-language-utils.js";

function renderPickerLanguageOption(language, selectedCode, disabled = false) {
  const isSelected = language.code === selectedCode;
  return `
    <button
      class="language-picker-modal__option${isSelected ? " is-selected" : ""}"
      type="button"
      data-action="select-target-language-manager-picker-language:${escapeHtml(language.code)}"
      aria-pressed="${isSelected ? "true" : "false"}"
      ${disabled ? 'disabled aria-disabled="true"' : ""}
    >
      <span>${escapeHtml(language.name)}</span>
      <span class="language-picker-modal__code">${escapeHtml(language.code)}</span>
    </button>
  `;
}

function renderManagedLanguageRow(language, index, total, isSubmitting) {
  const code = String(language?.code ?? "").trim();
  const name = languageDisplayName(language);
  const baseCode = languageBaseCode(language);
  const label = baseCode && baseCode !== code
    ? `${name} (${baseCode}, ${code})`
    : `${name} (${code})`;
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

  const availableLanguages = isoLanguageOptions
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name));
  const rawSelectedCode = findIsoLanguageOption(modal.pickerSelectedLanguageCode)?.code ?? "";
  const selectedCode = availableLanguages.some((language) => language.code === rawSelectedCode)
    ? rawSelectedCode
    : "";
  const offlineMode = state.offline?.isEnabled === true;

  return `
    <div class="modal-backdrop modal-backdrop--nested-picker">
      <section class="card modal-card modal-card--compact modal-card--language-picker">
        <div class="card__body modal-card__body language-picker-modal">
          <p class="card__eyebrow">CHAPTER LANGUAGES</p>
          <h2 class="modal__title">Add Language</h2>
          <p class="modal__supporting">Choose a language to add to this file.</p>
          <div class="language-picker-modal__list" role="list" data-target-language-manager-picker-list>
            ${availableLanguages.length > 0
              ? availableLanguages.map((language) => renderPickerLanguageOption(language, selectedCode, offlineMode)).join("")
              : '<p class="language-picker-modal__empty">No supported languages are available.</p>'}
          </div>
          <div class="modal__actions">
            ${secondaryButton("Cancel", "close-target-language-manager-picker")}
            ${primaryButton("Add language", "add-target-language-manager-language", { disabled: offlineMode || !selectedCode })}
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
  const offlineMode = state.offline?.isEnabled === true;
  const controlsDisabled = isSubmitting || offlineMode;
  const errorMarkup = modal.error
    ? `<p class="modal__error">${escapeHtml(formatErrorForDisplay(modal.error))}</p>`
    : "";

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--glossary-term modal-card--chapter-languages">
        <div class="card__body modal-card__body glossary-term-modal chapter-language-manager-modal">
          <p class="card__eyebrow">CHAPTER LANGUAGES</p>
          <h2 class="modal__title">Add / Remove Languages</h2>
          <p class="modal__supporting">This list determines which languages are shown and in what order. Translations for deleted languages are saved so that they can be recovered by re-adding the deleted language.</p>

          <section class="term-lane">
            <div class="term-lane__rows">
              ${languages.map((language, index) =>
                renderManagedLanguageRow(language, index, languages.length, controlsDisabled)).join("")}
            </div>
            <div class="term-lane__add-row">
              <button
                class="term-lane__add-button"
                type="button"
                data-action="open-target-language-manager-picker"
                aria-label="Add a new language"
                ${tooltipAttributes("Add a new language", { align: "end" })}
                ${controlsDisabled ? "disabled" : ""}
              ><span class="term-lane__add-icon" aria-hidden="true"></span></button>
            </div>
          </section>

          ${offlineMode ? '<p class="modal__supporting">Language changes are unavailable offline.</p>' : ""}
          ${errorMarkup}

          <div class="modal__actions">
            ${secondaryButton("Cancel", "close-target-language-manager", { disabled: isSubmitting })}
            ${offlineMode
              ? primaryButton("Save", "submit-target-language-manager", { disabled: true })
              : loadingPrimaryButton({
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
