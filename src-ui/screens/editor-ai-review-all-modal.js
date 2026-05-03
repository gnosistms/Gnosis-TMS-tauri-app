import { escapeHtml, loadingPrimaryButton, secondaryButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import {
  renderBatchLanguageProgressBars,
  renderBatchOverallProgress,
} from "./editor-batch-progress.js";

function languageForCode(editorChapter, languageCode) {
  const code = String(languageCode ?? "").trim();
  return (Array.isArray(editorChapter?.languages) ? editorChapter.languages : [])
    .find((language) => language?.code === code) ?? { code, name: code };
}

function renderError(modal) {
  return modal?.error
    ? `<p class="modal__error">${escapeHtml(formatErrorForDisplay(modal.error))}</p>`
    : "";
}

function renderModeOptions(modal, disabled) {
  const selectedMode = modal?.reviewMode === "meaning" ? "meaning" : "grammar";
  return `
    <div class="ai-translate-all-modal__language-list" role="radiogroup" aria-label="AI review mode">
      <label class="field__checkbox ai-translate-all-modal__language">
        <input
          type="radio"
          name="editor-ai-review-all-mode"
          data-editor-ai-review-all-mode
          value="grammar"
          ${selectedMode === "grammar" ? "checked" : ""}
          ${disabled ? "disabled" : ""}
        />
        <span>Check spelling and grammar only</span>
      </label>
      <label class="field__checkbox ai-translate-all-modal__language">
        <input
          type="radio"
          name="editor-ai-review-all-mode"
          data-editor-ai-review-all-mode
          value="meaning"
          ${selectedMode === "meaning" ? "checked" : ""}
          ${disabled ? "disabled" : ""}
        />
        <span>Check meaning against the source text</span>
      </label>
    </div>
  `;
}

function renderPreflightModal(modal) {
  const reviewedCount = Math.max(0, Number.parseInt(String(modal?.reviewedCount ?? 0), 10) || 0);
  const totalTranslationCount = Math.max(
    0,
    Number.parseInt(String(modal?.totalTranslationCount ?? 0), 10) || 0,
  );
  const skippedLabel = reviewedCount === 1 ? "translation is" : "translations are";
  const totalLabel = totalTranslationCount === 1 ? "translation" : "translations";
  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact modal-card--ai-translate-all">
        <div class="card__body modal-card__body ai-translate-all-modal">
          <p class="card__eyebrow">AI REVIEW</p>
          <h2 class="modal__title">Some translations are already reviewed</h2>
          <p class="modal__supporting">${escapeHtml(String(reviewedCount))} ${escapeHtml(skippedLabel)} already marked reviewed out of ${escapeHtml(String(totalTranslationCount))} non-empty ${escapeHtml(totalLabel)}. AI Review will skip reviewed translations.</p>
          ${renderError(modal)}
          <div class="modal__actions">
            ${secondaryButton("Cancel", "cancel-editor-ai-review-all")}
            ${loadingPrimaryButton({
              label: "Continue",
              loadingLabel: "Continue",
              action: "continue-editor-ai-review-all",
              isLoading: false,
            })}
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderConfigureModal(state, modal) {
  const offlineMode = state.offline?.isEnabled === true;
  const disabled = modal.status === "loading" || offlineMode;
  const confirmButton = offlineMode
    ? `
      <button class="button button--primary is-disabled" data-action="noop" disabled aria-disabled="true">
        <span>Begin review</span>
      </button>
    `
    : loadingPrimaryButton({
      label: "Begin review",
      loadingLabel: "Reviewing...",
      action: "confirm-editor-ai-review-all",
      isLoading: modal.status === "loading",
    });
  const supportingMarkup = offlineMode
    ? '<p class="modal__supporting">AI actions are unavailable offline.</p>'
    : '<p class="modal__supporting">Choose how AI should review every unreviewed translation in the selected target language.</p>';

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact modal-card--ai-translate-all">
        <div class="card__body modal-card__body ai-translate-all-modal">
          <p class="card__eyebrow">AI REVIEW</p>
          <h2 class="modal__title">AI Review target language</h2>
          ${supportingMarkup}
          ${renderModeOptions(modal, disabled)}
          ${renderError(modal)}
          <div class="modal__actions">
            ${secondaryButton("Cancel", "cancel-editor-ai-review-all", { disabled })}
            ${confirmButton}
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderReviewingModal(state, modal) {
  const language = languageForCode(state.editorChapter, modal.languageCode);
  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact modal-card--ai-translate-all">
        <div class="card__body modal-card__body ai-translate-all-modal">
          <p class="card__eyebrow">AI REVIEW</p>
          <h2 class="modal__title">Reviewing translations</h2>
          ${renderBatchOverallProgress(modal, "translation", "translations")}
          ${renderBatchLanguageProgressBars({
            languages: [language],
            selectedLanguageCodes: [modal.languageCode],
            languageProgress: modal.languageProgress,
            emptyMessage: "There are no translations to review.",
            progressLabel: "review progress",
          })}
          ${renderError(modal)}
          <div class="modal__actions">
            ${secondaryButton("Stop", "cancel-editor-ai-review-all")}
            ${loadingPrimaryButton({
              label: "Begin review",
              loadingLabel: "Reviewing...",
              action: "confirm-editor-ai-review-all",
              isLoading: true,
            })}
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderFilterEnabledModal() {
  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact modal-card--ai-translate-all">
        <div class="card__body modal-card__body ai-translate-all-modal">
          <p class="card__eyebrow">AI REVIEW</p>
          <h2 class="modal__title">Please check filter enabled</h2>
          <p class="modal__supporting">AI Review is finished. The Please check filter is now enabled so you can review translations that need attention.</p>
          <div class="modal__actions">
            ${loadingPrimaryButton({
              label: "Ok",
              loadingLabel: "Ok",
              action: "dismiss-editor-ai-review-all-filter",
              isLoading: false,
            })}
          </div>
        </div>
      </section>
    </div>
  `;
}

export function renderEditorAiReviewAllModal(state) {
  const modal = state.editorChapter?.aiReviewAllModal;
  if (!modal?.isOpen) {
    return "";
  }

  if (modal.step === "preflight") {
    return renderPreflightModal(modal);
  }
  if (modal.step === "reviewing") {
    return renderReviewingModal(state, modal);
  }
  if (modal.step === "filter-enabled") {
    return renderFilterEnabledModal();
  }

  return renderConfigureModal(state, modal);
}
