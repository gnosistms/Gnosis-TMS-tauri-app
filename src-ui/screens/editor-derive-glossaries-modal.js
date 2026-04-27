import {
  escapeHtml,
  loadingPrimaryButton,
  renderFlowArrowIcon,
  secondaryButton,
} from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import { resolveEditorDeriveGlossariesConfig } from "../app/editor-derive-glossaries-flow.js";
import {
  renderBatchLanguageProgressBars,
  renderBatchOverallProgress,
} from "./editor-batch-progress.js";

function languageName(language) {
  const code = String(language?.code ?? "").trim();
  return String(language?.name ?? "").trim() || code;
}

function disabledPrimaryButton(label) {
  return `
    <button class="button button--primary is-disabled" data-action="noop" disabled aria-disabled="true">
      <span>${escapeHtml(label)}</span>
    </button>
  `;
}

function renderLanguagePairs(config) {
  const targetName = languageName(config.glossaryTargetLanguage);
  return `
    <ul class="modal__list">
      ${config.derivableLanguages.map((language) => `
        <li>${escapeHtml(languageName(language))} to ${escapeHtml(targetName)}</li>
      `).join("")}
    </ul>
  `;
}

function renderDeriveGlossaryProgressLabel(sourceLanguage, targetLanguage) {
  return `
    <span class="glossary-card__language-flow ai-translate-all-modal__language-flow">
      <span>${escapeHtml(languageName(sourceLanguage))}</span>
      ${renderFlowArrowIcon("glossary-card__language-arrow")}
      <span>${escapeHtml(languageName(targetLanguage))}</span>
    </span>
  `;
}

export function renderEditorDeriveGlossariesModal(state) {
  const modal = state.editorChapter?.deriveGlossariesModal;
  if (!modal?.isOpen) {
    return "";
  }

  const config = resolveEditorDeriveGlossariesConfig(state.editorChapter);
  const isSubmitting = modal.status === "loading";
  const offlineMode = state.offline?.isEnabled === true;
  const errorMarkup = modal.error
    ? `<p class="modal__error">${escapeHtml(formatErrorForDisplay(modal.error))}</p>`
    : "";
  const cancelButton = secondaryButton(
    isSubmitting ? "Stop" : "Cancel",
    "cancel-editor-derive-glossaries",
  );
  const confirmButton = isSubmitting
    ? loadingPrimaryButton({
      label: "Continue",
      loadingLabel: "Deriving...",
      action: "confirm-editor-derive-glossaries",
      isLoading: true,
    })
    : offlineMode
      ? disabledPrimaryButton("Continue")
      : config.derivableLanguages.length > 0
      ? loadingPrimaryButton({
        label: "Continue",
        loadingLabel: "Deriving...",
        action: "confirm-editor-derive-glossaries",
        isLoading: false,
      })
      : disabledPrimaryButton("Continue");

  const languageStatusMarkup = isSubmitting
    ? `
      ${renderBatchOverallProgress(modal, "glossary", "glossaries")}
      ${renderBatchLanguageProgressBars({
        languages: config.derivableLanguages,
        selectedLanguageCodes: modal.selectedLanguageCodes,
        languageProgress: modal.languageProgress,
        emptyMessage: "There are no selected languages to derive.",
        progressLabel: "glossary derivation progress",
        renderLanguageLabel: (language) =>
          renderDeriveGlossaryProgressLabel(language, config.glossaryTargetLanguage),
      })}
    `
    : offlineMode
    ? '<p class="modal__supporting">AI actions are unavailable offline.</p>'
    : `
      <p class="modal__supporting">
        You have a glossary for ${escapeHtml(languageName(config.glossarySourceLanguage))} to ${escapeHtml(languageName(config.glossaryTargetLanguage))}. This feature will use the existing glossary to generate glossary information for the following language pairs:
      </p>
      ${renderLanguagePairs(config)}
    `;

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact modal-card--derive-glossaries">
        <div class="card__body modal-card__body ai-translate-all-modal">
          <p class="card__eyebrow">DERIVE GLOSSARIES</p>
          <h2 class="modal__title">Automatically generate glossaries</h2>
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
