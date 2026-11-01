import { escapeHtml, loadingPrimaryButton, secondaryButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import {
  EDITOR_AI_REVIEW_MODE_CLARITY,
  normalizeEditorAiReviewMode,
} from "../app/editor-ai-review-request.js";
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

const REVIEW_MODE_OPTIONS = [
  { value: "grammar", label: "Check spelling and grammar only" },
  { value: EDITOR_AI_REVIEW_MODE_CLARITY, label: "Identify parts that are difficult to understand" },
  { value: "meaning", label: "Also check the meaning against the source text" },
];

function renderModeOptions(modal, disabled) {
  const selectedMode = normalizeEditorAiReviewMode(modal?.reviewMode);
  const options = REVIEW_MODE_OPTIONS.map((option, index) => `
      <label class="field__checkbox ai-translate-all-modal__language">
        <input
          type="radio"
          name="editor-ai-review-all-mode"
          data-editor-ai-review-all-mode
          ${index === 0 ? "data-modal-initial-focus" : ""}
          value="${option.value}"
          ${selectedMode === option.value ? "checked" : ""}
          ${disabled ? "disabled" : ""}
        />
        <span>${escapeHtml(option.label)}</span>
      </label>`).join("");
  return `
    <div class="ai-translate-all-modal__language-list" role="radiogroup" aria-label="AI review mode">${options}
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
      <section class="card modal-card modal-card--compact modal-card--ai-translate-all" role="dialog" aria-modal="true" aria-labelledby="editor-ai-review-preflight-modal-title" data-modal-dialog="editor-ai-review:preflight" tabindex="-1">
        <div class="card__body modal-card__body ai-translate-all-modal">
          <p class="card__eyebrow">AI REVIEW</p>
          <h2 class="modal__title" id="editor-ai-review-preflight-modal-title">Some translations are already reviewed</h2>
          <p class="modal__supporting">${escapeHtml(String(reviewedCount))} ${escapeHtml(skippedLabel)} already marked reviewed out of ${escapeHtml(String(totalTranslationCount))} non-empty target language ${escapeHtml(totalLabel)}. AI Review will skip reviewed translations.</p>
          <p class="modal__supporting">If you want to review all of the translations, cancel this review, remove the "reviewed" mark from all the translations, and then restart the AI review. There's a button to remove the reviewed mark from all translations on the right side of the Gnosis TMS toolbar.</p>
          ${renderError(modal)}
          <div class="modal__actions">
            ${secondaryButton("Cancel", "cancel-editor-ai-review-all", { modalCancel: true })}
            ${loadingPrimaryButton({
              label: "Continue",
              loadingLabel: "Continue",
              action: "continue-editor-ai-review-all",
              isLoading: false,
              modalDefault: true,
            })}
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderConfigureModal(state, modal) {
  const offlineMode = state.offline?.isEnabled === true;
  const disabled = modal.status === "loading" || modal.status === "preparing" || offlineMode;
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
      modalDefault: true,
    });
  const supportingMarkup = offlineMode
    ? '<p class="modal__supporting">AI actions are unavailable offline.</p>'
    : '<p class="modal__supporting">Choose how AI should review every unreviewed translation in the selected target language.</p>';

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact modal-card--ai-translate-all" role="dialog" aria-modal="true" aria-labelledby="editor-ai-review-configure-modal-title" data-modal-dialog="editor-ai-review:configure" tabindex="-1">
        <div class="card__body modal-card__body ai-translate-all-modal">
          <p class="card__eyebrow">AI REVIEW</p>
          <h2 class="modal__title" id="editor-ai-review-configure-modal-title">AI Review target language</h2>
          ${supportingMarkup}
          ${renderModeOptions(modal, disabled)}
          ${renderError(modal)}
          <div class="modal__actions">
            ${secondaryButton("Cancel", "cancel-editor-ai-review-all", {
              disabled,
              modalCancel: true,
            })}
            ${confirmButton}
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderReviewingModal(state, modal) {
  const language = languageForCode(state.editorChapter, modal.languageCode);
  const isPreparing = modal.status === "preparing";
  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact modal-card--ai-translate-all" role="dialog" aria-modal="true" aria-labelledby="editor-ai-review-running-modal-title" aria-busy="true" data-modal-dialog="editor-ai-review:running" tabindex="-1">
        <div class="card__body modal-card__body ai-translate-all-modal">
          <p class="card__eyebrow">AI REVIEW</p>
          <h2 class="modal__title" id="editor-ai-review-running-modal-title">${isPreparing ? "Preparing review" : "Reviewing translations"}</h2>
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
            ${secondaryButton("Stop", "cancel-editor-ai-review-all", {
              disabled: isPreparing,
              modalInitialFocus: !isPreparing,
            })}
            ${loadingPrimaryButton({
              label: "Begin review",
              loadingLabel: isPreparing ? "Preparing..." : "Reviewing...",
              action: "confirm-editor-ai-review-all",
              isLoading: true,
            })}
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderFilterEnabledModal(modal) {
  const completedCount = Number(modal?.completedCount) || 0;
  const totalCount = Number(modal?.totalCount) || 0;
  const progressLine = totalCount > 0
    ? `<p class="modal__supporting"><strong>${completedCount} of ${totalCount}</strong> unreviewed translation${totalCount === 1 ? "" : "s"} ${completedCount === 1 ? "was" : "were"} reviewed in this run.</p>`
    : "";

  if (normalizeEditorAiReviewMode(modal?.reviewMode) === EDITOR_AI_REVIEW_MODE_CLARITY) {
    return renderClarityFinishedModal(modal, progressLine);
  }

  // A run that ended on an error must never present the success copy — with
  // a provider outage every call can fail in seconds and nothing is
  // reviewed, which previously still showed "AI Review is finished".
  if (modal?.error) {
    return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact modal-card--ai-translate-all" role="dialog" aria-modal="true" aria-labelledby="editor-ai-review-stopped-modal-title" data-modal-dialog="editor-ai-review:stopped" tabindex="-1">
        <div class="card__body modal-card__body ai-translate-all-modal">
          <p class="card__eyebrow">AI REVIEW</p>
          <h2 class="modal__title" id="editor-ai-review-stopped-modal-title">AI Review stopped</h2>
          ${renderError(modal)}
          ${progressLine}
          <p class="modal__supporting">Rows the AI already reviewed are marked with the red &quot;please check&quot; (?) status, and the Please check filter is enabled so you can find them. Run AI Review again to continue &mdash; it only reviews rows without the &quot;mark reviewed&quot; [&#10003;] mark, so finished rows are not reviewed twice.</p>
          <div class="modal__actions">
            ${loadingPrimaryButton({
              label: "Ok",
              loadingLabel: "Ok",
              action: "dismiss-editor-ai-review-all-filter",
              isLoading: false,
              modalDefault: true,
              modalCancel: true,
              modalInitialFocus: true,
            })}
          </div>
        </div>
      </section>
    </div>
  `;
  }

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact modal-card--ai-translate-all" role="dialog" aria-modal="true" aria-labelledby="editor-ai-review-finished-modal-title" data-modal-dialog="editor-ai-review:finished" tabindex="-1">
        <div class="card__body modal-card__body ai-translate-all-modal">
          <p class="card__eyebrow">AI REVIEW</p>
          <h2 class="modal__title" id="editor-ai-review-finished-modal-title">Please check filter enabled</h2>
          <p class="modal__supporting">AI Review is finished. The Please check filter is now enabled so you can review translations that need attention. The AI Review has already made the recommended corrections and marked the corrected sections by setting the red &quot;please check&quot; (?) button on each one. Your job now is to open the history tab so you can see what changed.</p>
          ${progressLine}
          <ul class="modal__list">
            <li>If you like what the AI did, just click the &quot;mark reviewed&quot; [&#10003;] button and then click the [?] button to remove the &quot;please check&quot; status.</li>
            <li>If you don't like the changes, use the history to restore the previous version or edit the text as desired.</li>
          </ul>
          <p class="modal__supporting">When you're done checking, you can repeat the AI review again. The AI review will only review the text that doesn't have the &quot;mark reviewed&quot; [&#10003;] mark set.</p>
          <div class="modal__actions">
            ${loadingPrimaryButton({
              label: "Ok",
              loadingLabel: "Ok",
              action: "dismiss-editor-ai-review-all-filter",
              isLoading: false,
              modalDefault: true,
              modalCancel: true,
              modalInitialFocus: true,
            })}
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderClarityFinishedModal(modal, progressLine) {
  const flaggedCount = Number(modal?.flaggedCount) || 0;
  const okButton = loadingPrimaryButton({
    label: "Ok",
    loadingLabel: "Ok",
    action: "dismiss-editor-ai-review-all-filter",
    isLoading: false,
    modalDefault: true,
    modalCancel: true,
    modalInitialFocus: true,
  });
  const flaggedLine = `<p class="modal__supporting">The AI found <strong>${flaggedCount}</strong> translation${flaggedCount === 1 ? "" : "s"} with parts that are difficult to understand. It did not change any text.</p>`;

  if (modal?.error) {
    return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact modal-card--ai-translate-all" role="dialog" aria-modal="true" aria-labelledby="editor-ai-review-stopped-modal-title" data-modal-dialog="editor-ai-review:stopped" tabindex="-1">
        <div class="card__body modal-card__body ai-translate-all-modal">
          <p class="card__eyebrow">AI REVIEW</p>
          <h2 class="modal__title" id="editor-ai-review-stopped-modal-title">AI Review stopped</h2>
          ${renderError(modal)}
          ${progressLine}
          ${flaggedLine}
          <p class="modal__supporting">Translations the AI found difficult to understand are marked with the red &quot;please check&quot; (?) status and have a comment from AI Review, and the Please check filter is enabled so you can find them. Run the check again to continue &mdash; it skips translations it already commented on unless their text has changed.</p>
          <div class="modal__actions">
            ${okButton}
          </div>
        </div>
      </section>
    </div>
  `;
  }

  if (flaggedCount === 0) {
    return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact modal-card--ai-translate-all" role="dialog" aria-modal="true" aria-labelledby="editor-ai-review-finished-modal-title" data-modal-dialog="editor-ai-review:finished" tabindex="-1">
        <div class="card__body modal-card__body ai-translate-all-modal">
          <p class="card__eyebrow">AI REVIEW</p>
          <h2 class="modal__title" id="editor-ai-review-finished-modal-title">Nothing difficult to understand</h2>
          <p class="modal__supporting">The AI found no parts that are difficult to understand in the translations it checked, and it did not change any text.</p>
          ${progressLine}
          <div class="modal__actions">
            ${okButton}
          </div>
        </div>
      </section>
    </div>
  `;
  }

  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact modal-card--ai-translate-all" role="dialog" aria-modal="true" aria-labelledby="editor-ai-review-finished-modal-title" data-modal-dialog="editor-ai-review:finished" tabindex="-1">
        <div class="card__body modal-card__body ai-translate-all-modal">
          <p class="card__eyebrow">AI REVIEW</p>
          <h2 class="modal__title" id="editor-ai-review-finished-modal-title">Please check filter enabled</h2>
          <p class="modal__supporting">AI Review is finished, and the Please check filter is now enabled. Where part of a translation is difficult to understand, the AI set the red &quot;please check&quot; (?) status and wrote a comment explaining the problem.</p>
          ${flaggedLine}
          ${progressLine}
          <ul class="modal__list">
            <li>Open the comments for each translation to read the AI's explanation.</li>
            <li>When you're done with a translation, click the [?] button to remove the &quot;please check&quot; status. You can delete the AI's comment too.</li>
          </ul>
          <p class="modal__supporting">If you run this check again, it skips translations it already commented on unless their text has changed.</p>
          <div class="modal__actions">
            ${okButton}
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
    return renderFilterEnabledModal(modal);
  }

  return renderConfigureModal(state, modal);
}
