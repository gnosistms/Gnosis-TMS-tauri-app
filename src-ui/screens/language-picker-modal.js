// Shared language picker: an alphabetised list of the supported languages with
// the alphabet slider (attached after render by
// syncLanguagePickerAlphabetIndexes, which finds `.language-picker-modal__list`).
// Chinese appears as two languages, zh-Hans (Simplified) and zh-Hant
// (Traditional), as everywhere in the app; bare "zh" is not offered.

import { escapeHtml } from "../lib/ui.js";
import { findIsoLanguageOption, isoLanguageOptions } from "../lib/language-options.js";

export function sortedLanguageOptions(languages = isoLanguageOptions) {
  return languages.slice().sort((left, right) => left.name.localeCompare(right.name));
}

/** The supported option for a code (case and "_" vs "-" tolerant), or "". */
export function pickerSelectedCode(code, languages = isoLanguageOptions) {
  const canonical = findIsoLanguageOption(code)?.code ?? "";
  return languages.some((language) => language.code === canonical) ? canonical : "";
}

export function renderLanguagePickerOption(language, { selectedCode, selectAction, disabled = false }) {
  const isSelected = language.code === selectedCode;
  return `
    <button
      class="language-picker-modal__option${isSelected ? " is-selected" : ""}"
      type="button"
      data-action="${escapeHtml(selectAction)}:${escapeHtml(language.code)}"
      data-roving-choice-option
      role="option"
      aria-selected="${isSelected ? "true" : "false"}"
      aria-pressed="${isSelected ? "true" : "false"}"
      tabindex="${isSelected ? "0" : "-1"}"
      ${disabled ? 'disabled aria-disabled="true"' : ""}
    >
      <span>${escapeHtml(language.name)}</span>
      <span class="language-picker-modal__code">${escapeHtml(language.code)}</span>
    </button>
  `;
}

/**
 * Options:
 *   dialogName, titleId, eyebrow, title, supporting (plain text or ""),
 *   beforeListHtml (e.g. an error), listLabel, listAttribute (data-* marker),
 *   selectedCode, selectAction (action prefix; ":<code>" is appended),
 *   disabled, nested (render over another modal), actionsHtml,
 *   languages (defaults to every supported language, sorted),
 *   emptyText.
 */
export function renderLanguagePickerModal(options) {
  const languages = options.languages ?? sortedLanguageOptions();
  const selectedCode = pickerSelectedCode(options.selectedCode, languages);
  const backdropClass = options.nested ? "modal-backdrop modal-backdrop--nested-picker" : "modal-backdrop";
  const list = languages.length > 0
    ? languages.map((language) => renderLanguagePickerOption(language, {
      selectedCode,
      selectAction: options.selectAction,
      disabled: options.disabled === true,
    })).join("")
    : `<p class="language-picker-modal__empty">${escapeHtml(options.emptyText ?? "No supported languages are available.")}</p>`;
  return `
    <div class="${backdropClass}">
      <section class="card modal-card modal-card--compact modal-card--language-picker" role="dialog" aria-modal="true" aria-labelledby="${escapeHtml(options.titleId)}" data-modal-dialog="${escapeHtml(options.dialogName)}" tabindex="-1">
        <div class="card__body modal-card__body language-picker-modal">
          <p class="card__eyebrow">${escapeHtml(options.eyebrow)}</p>
          <h2 class="modal__title" id="${escapeHtml(options.titleId)}">${escapeHtml(options.title)}</h2>
          ${options.supporting ? `<p class="modal__supporting">${escapeHtml(options.supporting)}</p>` : ""}
          ${options.beforeListHtml ?? ""}
          <div class="language-picker-modal__list-frame">
            <div class="language-picker-modal__list" role="listbox" aria-label="${escapeHtml(options.listLabel)}" ${options.listAttribute ?? ""} data-roving-choice-group data-roving-choice-axis="vertical">
              ${list}
            </div>
          </div>
          <div class="modal__actions">
            ${options.actionsHtml}
          </div>
        </div>
      </section>
    </div>
  `;
}
