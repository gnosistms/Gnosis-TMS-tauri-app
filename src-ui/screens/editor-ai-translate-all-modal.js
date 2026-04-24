import { escapeHtml, loadingPrimaryButton, secondaryButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";

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

function normalizedProgressEntry(languageProgress, languageCode) {
  const progress =
    languageProgress && typeof languageProgress === "object"
      ? languageProgress[languageCode]
      : null;
  const completedCount = Math.max(0, Number.parseInt(String(progress?.completedCount ?? 0), 10) || 0);
  const totalCount = Math.max(0, Number.parseInt(String(progress?.totalCount ?? 0), 10) || 0);
  const percent = totalCount > 0
    ? Math.max(0, Math.min(100, Math.round((completedCount / totalCount) * 100)))
    : 100;
  return {
    completedCount: Math.min(completedCount, totalCount),
    totalCount,
    percent,
  };
}

function renderLanguageProgressBars(languages, selectedLanguageCodes, languageProgress) {
  const selected = new Set(Array.isArray(selectedLanguageCodes) ? selectedLanguageCodes : []);
  const selectedLanguages = languages.filter((language) =>
    selected.has(String(language?.code ?? "").trim()),
  );
  if (selectedLanguages.length === 0) {
    return '<p class="modal__supporting">There are no selected languages to translate.</p>';
  }

  return `
    <div class="ai-translate-all-modal__progress-list">
      ${selectedLanguages.map((language) => {
        const code = String(language?.code ?? "").trim();
        const name = String(language?.name ?? "").trim() || code;
        const progress = normalizedProgressEntry(languageProgress, code);
        return `
          <div class="ai-translate-all-modal__progress-row">
            <div class="ai-translate-all-modal__progress-label">
              <span>${escapeHtml(name)}</span>
              <span>${escapeHtml(String(progress.completedCount))} / ${escapeHtml(String(progress.totalCount))}</span>
            </div>
            <div
              class="ai-translate-all-modal__progress-track"
              role="progressbar"
              aria-label="${escapeHtml(`${name} translation progress`)}"
              aria-valuemin="0"
              aria-valuemax="${escapeHtml(String(progress.totalCount))}"
              aria-valuenow="${escapeHtml(String(progress.completedCount))}"
            >
              <div class="ai-translate-all-modal__progress-fill" style="width: ${escapeHtml(String(progress.percent))}%;"></div>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderOverallProgress(modal) {
  const completedCount = Math.max(0, Number.parseInt(String(modal?.translatedCount ?? 0), 10) || 0);
  const totalCount = Math.max(0, Number.parseInt(String(modal?.totalCount ?? 0), 10) || 0);
  const translationLabel = totalCount === 1 ? "translation" : "translations";
  return `
    <p class="ai-translate-all-modal__progress-summary">
      ${escapeHtml(String(Math.min(completedCount, totalCount)))} / ${escapeHtml(String(totalCount))} ${escapeHtml(translationLabel)} completed
    </p>
  `;
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
    : renderLanguageCheckboxes(languages, modal.selectedLanguageCodes, false);
  const supportingMarkup = isSubmitting
    ? ""
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
