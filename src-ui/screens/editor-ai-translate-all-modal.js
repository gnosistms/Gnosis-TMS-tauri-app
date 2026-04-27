import { escapeHtml, loadingPrimaryButton, secondaryButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import {
  renderBatchLanguageProgressBars,
  renderBatchOverallProgress,
} from "./editor-batch-progress.js";

function visibleTargetLanguages(editorChapter) {
  const languages = Array.isArray(editorChapter?.languages) ? editorChapter.languages : [];
  const sourceLanguageCode =
    String(editorChapter?.selectedSourceLanguageCode ?? "").trim()
    || languages.find((language) => language?.role === "source")?.code
    || languages[0]?.code
    || "";
  const collapsedLanguageCodes =
    editorChapter?.collapsedLanguageCodes instanceof Set
      ? editorChapter.collapsedLanguageCodes
      : new Set();

  return languages
    .filter((language) => {
      const code = String(language?.code ?? "").trim();
      return code && code !== sourceLanguageCode && !collapsedLanguageCodes.has(code);
    });
}

function renderLanguageCheckboxes(languages, selectedLanguageCodes, disabled) {
  if (languages.length === 0) {
    return '<p class="modal__supporting">There are no visible target languages to translate.</p>';
  }

  const selected = new Set(Array.isArray(selectedLanguageCodes) ? selectedLanguageCodes : []);
  return `
    <div class="ai-translate-all-modal__language-list">
      ${languages.map((language) => {
        const code = String(language?.code ?? "").trim();
        const name = String(language?.name ?? "").trim() || code;
        return `
          <label class="field__checkbox ai-translate-all-modal__language">
            <input
              type="checkbox"
              data-editor-ai-translate-all-language
              value="${escapeHtml(code)}"
              ${selected.has(code) ? "checked" : ""}
              ${disabled ? "disabled" : ""}
            />
            <span>${escapeHtml(name)}</span>
          </label>
        `;
      }).join("")}
    </div>
  `;
}

function renderLanguageProgressBars(languages, selectedLanguageCodes, languageProgress) {
  return renderBatchLanguageProgressBars({
    languages,
    selectedLanguageCodes,
    languageProgress,
    emptyMessage: "There are no selected languages to translate.",
    progressLabel: "translation progress",
  });
}

function renderOverallProgress(modal) {
  return renderBatchOverallProgress(modal, "translation", "translations");
}

function disabledPrimaryButton(label) {
  return `
    <button class="button button--primary is-disabled" data-action="noop" disabled aria-disabled="true">
      <span>${escapeHtml(label)}</span>
    </button>
  `;
}

export function renderEditorAiTranslateAllModal(state) {
  const modal = state.editorChapter?.aiTranslateAllModal;
  if (!modal?.isOpen) {
    return "";
  }

  const isSubmitting = modal.status === "loading";
  const offlineMode = state.offline?.isEnabled === true;
  const languages = visibleTargetLanguages(state.editorChapter);
  const hasSelection =
    Array.isArray(modal.selectedLanguageCodes)
    && modal.selectedLanguageCodes.some((code) =>
      languages.some((language) => language.code === code),
    );
  const errorMarkup = modal.error
    ? `<p class="modal__error">${escapeHtml(formatErrorForDisplay(modal.error))}</p>`
    : "";
  const cancelButton = secondaryButton(
    isSubmitting ? "Stop" : "Cancel",
    "cancel-editor-ai-translate-all",
  );
  const confirmButton = isSubmitting
    ? loadingPrimaryButton({
      label: "Begin translating",
      loadingLabel: "Translating...",
      action: "confirm-editor-ai-translate-all",
      isLoading: true,
    })
    : offlineMode
      ? disabledPrimaryButton("Begin translating")
      : hasSelection
      ? loadingPrimaryButton({
        label: "Begin translating",
        loadingLabel: "Translating...",
        action: "confirm-editor-ai-translate-all",
        isLoading: false,
      })
      : disabledPrimaryButton("Begin translating");
  const languageStatusMarkup = isSubmitting
    ? `
      ${renderOverallProgress(modal)}
      ${renderLanguageProgressBars(languages, modal.selectedLanguageCodes, modal.languageProgress)}
    `
    : renderLanguageCheckboxes(languages, modal.selectedLanguageCodes, offlineMode);
  const supportingMarkup = isSubmitting
    ? ""
    : offlineMode
      ? '<p class="modal__supporting">AI actions are unavailable offline.</p>'
      : '<p class="modal__supporting">Select languages below to use AI translation to fill all empty fields for the selected languages. If there are existing translations for the selected language, this will not overwrite them; it only fills empty spaces.</p>';

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact modal-card--ai-translate-all">
        <div class="card__body modal-card__body ai-translate-all-modal">
          <p class="card__eyebrow">BATCH TRANSLATE</p>
          <h2 class="modal__title">AI Translate the entire file</h2>
          ${supportingMarkup}
          ${languageStatusMarkup}
          ${errorMarkup}
          <div class="modal__actions">
            ${cancelButton}
            ${confirmButton}
          </div>
        </div>
      </section>
    </div>
  `;
}
