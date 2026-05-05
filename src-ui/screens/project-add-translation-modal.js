import { escapeHtml, primaryButton, secondaryButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import { findIsoLanguageOption, isoLanguageOptions } from "../lib/language-options.js";

function renderError(error) {
  const text = typeof error === "string" ? error.trim() : "";
  return text
    ? `<div class="project-import-modal__error-badge" role="alert">${escapeHtml(formatErrorForDisplay(text))}</div>`
    : "";
}

function renderPasteModal(modal) {
  const value = typeof modal?.pastedText === "string" ? modal.pastedText : "";
  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">Add translations</p>
          <h2 class="modal__title">Paste your translation</h2>
          <p class="modal__supporting">Paste your translation text for the entire file into the box below. Your text will be automatically aligned with the existing text and inserted.</p>
          <div class="modal__form">
            ${renderError(modal.error)}
            <textarea
              class="field__textarea"
              rows="10"
              placeholder="Paste your translation here."
              data-project-add-translation-textarea
            >${escapeHtml(value)}</textarea>
          </div>
          <div class="modal__actions">
            ${secondaryButton("Cancel", "cancel-project-add-translation")}
            ${primaryButton("Continue", "submit-project-add-translation-paste", { disabled: !value.trim() })}
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderLanguageOption(language, selectedCode) {
  const isSelected = language.code === selectedCode;
  return `
    <button
      class="language-picker-modal__option${isSelected ? " is-selected" : ""}"
      type="button"
      data-action="select-project-add-translation-language:${escapeHtml(language.code)}"
      aria-pressed="${isSelected ? "true" : "false"}"
    >
      <span>${escapeHtml(language.name)}</span>
      <span class="language-picker-modal__code">${escapeHtml(language.code)}</span>
    </button>
  `;
}

function renderLanguageModal(modal) {
  const selectedCode = findIsoLanguageOption(modal.targetLanguageCode)?.code ?? "";
  const languages = isoLanguageOptions
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name));
  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact modal-card--language-picker">
        <div class="card__body modal-card__body language-picker-modal">
          <p class="card__eyebrow">TRANSLATION LANGUAGE</p>
          <h2 class="modal__title">What language did you paste?</h2>
          <p class="modal__supporting">Select the language of the pasted translation text.</p>
          ${renderError(modal.error)}
          <div class="language-picker-modal__list" role="list" data-project-add-translation-language-list>
            ${languages.map((language) => renderLanguageOption(language, selectedCode)).join("")}
          </div>
          <div class="modal__actions">
            ${secondaryButton("Cancel", "cancel-project-add-translation")}
            ${primaryButton("Continue", "continue-project-add-translation-language", { disabled: !selectedCode })}
          </div>
        </div>
      </section>
    </div>
  `;
}

function progressLabel(progress) {
  if (!progress) {
    return "";
  }
  const completed = Number(progress.completed);
  const total = Number(progress.total);
  if (Number.isFinite(completed) && Number.isFinite(total) && total > 0) {
    return `${completed} / ${total}`;
  }
  const percent = Number(progress.percent);
  return Number.isFinite(percent) ? `${Math.round(percent)}%` : "";
}

const ALIGNMENT_PROGRESS_STEPS = [
  { id: "prepare_units", label: "Preparing text units" },
  { id: "summarize_sections", label: "Summarizing sections" },
  { id: "find_section_matches", label: "Finding section matches" },
  { id: "select_corridor", label: "Selecting section corridor" },
  { id: "row_alignment", label: "Aligning rows inside matched sections" },
  { id: "resolve_conflicts", label: "Resolving conflicts" },
  { id: "split_targets", label: "Splitting combined target rows" },
  { id: "final_checks", label: "Final checks" },
  { id: "apply", label: "Applying translation" },
];

function progressPercent(progress) {
  const percent = Number(progress?.percent);
  if (Number.isFinite(percent)) {
    return Math.max(0, Math.min(100, percent));
  }

  const completed = Number(progress?.completed);
  const total = Number(progress?.total);
  if (Number.isFinite(completed) && Number.isFinite(total) && total > 0) {
    return Math.max(0, Math.min(100, (completed / total) * 100));
  }

  return progress?.status === "complete" ? 100 : 0;
}

function progressStepPercent(step, progress, index, activeIndex) {
  if (activeIndex < 0) {
    return 0;
  }
  if (index < activeIndex) {
    return 100;
  }
  if (index > activeIndex) {
    return 0;
  }
  if (progress?.status === "complete") {
    return 100;
  }
  if (progress?.status === "warning") {
    return 100;
  }
  return progressPercent(progress);
}

function renderProgressStep(step, progress, index, activeIndex) {
  const percent = progressStepPercent(step, progress, index, activeIndex);
  const roundedPercent = Math.round(percent);
  const isActive = index === activeIndex && progress?.status !== "complete";
  const isComplete = percent >= 100;
  return `
    <li class="add-translation-progress__step${isActive ? " is-active" : ""}${isComplete ? " is-complete" : ""}">
      <div class="add-translation-progress__step-header">
        <span class="add-translation-progress__step-number">${index + 1}</span>
        <span class="add-translation-progress__step-label">${escapeHtml(step.label)}</span>
        <span class="add-translation-progress__step-value">${roundedPercent}%</span>
      </div>
      <div
        class="add-translation-progress__bar"
        role="progressbar"
        aria-label="${escapeHtml(step.label)}"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow="${roundedPercent}"
      >
        <span class="add-translation-progress__bar-fill" style="width: ${roundedPercent}%"></span>
      </div>
    </li>
  `;
}

function resolveActiveProgressStepIndex(progress) {
  const stageId = typeof progress?.stageId === "string" ? progress.stageId : "";
  const activeIndex = ALIGNMENT_PROGRESS_STEPS.findIndex((step) => step.id === stageId);
  if (activeIndex >= 0) {
    return activeIndex;
  }
  if (stageId === "preflight") {
    return progress?.status === "complete"
      ? ALIGNMENT_PROGRESS_STEPS.findIndex((step) => step.id === "final_checks")
      : 0;
  }
  if (stageId === "mismatch_gate") {
    return ALIGNMENT_PROGRESS_STEPS.findIndex((step) => step.id === "final_checks");
  }
  return -1;
}

function renderProgressModal(modal) {
  const progress = modal.progress ?? {};
  const activeIndex = resolveActiveProgressStepIndex(progress);
  const detail = [progress.message, progressLabel(progress)].filter(Boolean).join(" ");
  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact modal-card--navigation-loading modal-card--add-translation-progress" role="status" aria-busy="true">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">Aligning and inserting</p>
          <h2 class="modal__title">Please wait</h2>
          <ol class="add-translation-progress" aria-label="Alignment and insertion progress">
            ${ALIGNMENT_PROGRESS_STEPS.map((step, index) => renderProgressStep(step, progress, index, activeIndex)).join("")}
          </ol>
          ${detail ? `<p class="modal__supporting add-translation-progress__detail">${escapeHtml(detail)}</p>` : ""}
          ${renderError(modal.error)}
        </div>
      </section>
    </div>
  `;
}

function renderExistingTranslationsModal(modal) {
  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">EXISTING TRANSLATIONS</p>
          <h2 class="modal__title">This language already has translation text</h2>
          <p class="modal__supporting">When you insert to this language, your text will only be inserted into the empty rows. It will not overwrite the existing translations. If you intend to insert for the entire file, cancel and delete the existing text first.</p>
          ${renderError(modal.error)}
          <div class="modal__actions">
            ${secondaryButton("Cancel", "cancel-project-add-translation")}
            ${primaryButton("Insert to empty rows", "continue-project-add-translation-existing")}
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderMismatchModal(modal) {
  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">TEXT MISMATCH</p>
          <h2 class="modal__title">Inserted text does not match well</h2>
          <p class="modal__supporting">Much of the text does not match and can not be aligned. We recommend you check the inserted text to make sure it really is a translation of the text in this file. If you continue with the insert operation, non-similar paragraphs will be aligned with empty space.</p>
          ${renderError(modal.error)}
          <div class="modal__actions">
            ${secondaryButton("Cancel", "cancel-project-add-translation")}
            ${primaryButton("Continue", "continue-project-add-translation-mismatch")}
          </div>
        </div>
      </section>
    </div>
  `;
}

export function renderProjectAddTranslationModal(state) {
  const modal = state.projectAddTranslation;
  if (!modal?.isOpen) {
    return "";
  }
  if (modal.step === "selectLanguage") {
    return renderLanguageModal(modal);
  }
  if (modal.step === "aligning" || modal.step === "applying") {
    return renderProgressModal(modal);
  }
  if (modal.step === "existingTranslationWarning") {
    return renderExistingTranslationsModal(modal);
  }
  if (modal.step === "mismatchWarning") {
    return renderMismatchModal(modal);
  }
  return renderPasteModal(modal);
}
