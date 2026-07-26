import { escapeHtml, primaryButton, secondaryButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import { findIsoLanguageOption, isoLanguageOptions } from "../lib/language-options.js";
import {
  renderProjectDocumentInputModal,
  renderProjectDocumentLinkError,
} from "../app/project-document-input.js";

function renderError(error) {
  const text = typeof error === "string" ? error.trim() : "";
  return text
    ? `<div class="project-import-modal__error-badge" role="alert">${escapeHtml(formatErrorForDisplay(text))}</div>`
    : "";
}

function renderInputModal(modal) {
  const isResolvingLink = modal.status === "resolvingLink";
  const isExtracting = modal.status === "extracting";
  return renderProjectDocumentInputModal(modal, {
    modalId: "project-add-translation",
    eyebrow: "ADD TRANSLATIONS",
    title: "Add translation text",
    supportingText: "Choose how to provide the translation for this entire file. The text will be automatically aligned and inserted.",
    modeAriaLabel: "Add translation method",
    selectModeAction: "select-project-add-translation-input-mode",
    selectFileAction: "select-project-add-translation-file",
    submitLinkAction: "submit-project-add-translation-link",
    submitPasteAction: "submit-project-add-translation-paste",
    cancelAction: "cancel-project-add-translation",
    dropzoneAttribute: "data-project-add-translation-dropzone",
    dropzoneLabel: "Drop one file here or click to open the file selector.",
    uploadHint: "Supported formats: .txt, .docx, or .rtf. Only plain text is added; the existing chapter keeps its formatting.",
    linkInputId: "project-add-translation-link-input",
    linkInputAttribute: "data-project-add-translation-link-input",
    linkPlaceholder: "https://docs.google.com/document/d/...",
    linkHint: "Paste a public Google Docs link here.",
    pasteInputAttribute: "data-project-add-translation-textarea",
    pastePlaceholder: "Paste your translation here.",
    pasteHint: "Paste the translation text for the entire file.",
    selectFileLabel: "Select file",
    processingUploadLabel: "Opening...",
    processingPasteLabel: "Continue",
    controlsDisabled: isResolvingLink || isExtracting,
    isResolvingLink,
    isProcessingUpload: isExtracting,
    isProcessingPaste: false,
  });
}

function renderLanguageOption(language, selectedCode) {
  const isSelected = language.code === selectedCode;
  return `
    <button
      class="language-picker-modal__option${isSelected ? " is-selected" : ""}"
      type="button"
      data-action="select-project-add-translation-language:${escapeHtml(language.code)}"
      data-roving-choice-option
      role="option"
      aria-selected="${isSelected ? "true" : "false"}"
      aria-pressed="${isSelected ? "true" : "false"}"
      tabindex="${isSelected ? "0" : "-1"}"
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
      <section class="card modal-card modal-card--compact modal-card--language-picker" role="dialog" aria-modal="true" aria-labelledby="project-add-translation-language-modal-title" data-modal-dialog="project-add-translation:language" tabindex="-1">
        <div class="card__body modal-card__body language-picker-modal">
          <p class="card__eyebrow">TRANSLATION LANGUAGE</p>
          <h2 class="modal__title" id="project-add-translation-language-modal-title">What language is this translation?</h2>
          <p class="modal__supporting">Select the language of the translation text.</p>
          ${renderError(modal.error)}
          <div class="language-picker-modal__list-frame">
            <div class="language-picker-modal__list" role="listbox" aria-label="Translation language" data-project-add-translation-language-list data-roving-choice-group data-roving-choice-axis="vertical">
              ${languages.map((language) => renderLanguageOption(language, selectedCode)).join("")}
            </div>
          </div>
          <div class="modal__actions">
            ${secondaryButton("Cancel", "cancel-project-add-translation", { modalCancel: true })}
            ${primaryButton("Continue", "continue-project-add-translation-language", {
              disabled: !selectedCode,
              modalDefault: true,
            })}
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

const MULTI_ALIGNMENT_PROGRESS_STEPS = [
  { id: "prepare_units", label: "Preparing text units", stageIds: ["prepare_units"] },
  { id: "summarize_sections", label: "Summarizing sections", stageIds: ["summarize_sections"] },
  { id: "find_section_matches", label: "Finding section matches", stageIds: ["find_section_matches"] },
  { id: "select_corridor", label: "Choosing the best matches", stageIds: ["select_corridor"] },
  { id: "row_alignment", label: "Aligning paragraphs", stageIds: ["row_alignment"] },
  { id: "resolve_conflicts", label: "Resolving conflicts", stageIds: ["resolve_conflicts"] },
  { id: "split_targets", label: "Splitting combined target rows", stageIds: ["split_targets"] },
  { id: "final_checks", label: "Final checks", stageIds: ["final_checks", "preflight", "mismatch_gate"] },
  { id: "apply", label: "Applying translation", stageIds: ["apply"] },
];

const SINGLE_ALIGNMENT_PROGRESS_STEPS = [
  { id: "prepare_units", label: "Preparing text", stageIds: ["prepare_units"] },
  {
    id: "aligning",
    label: "Aligning translation",
    stageIds: [
      "row_alignment",
      "resolve_conflicts",
      "split_targets",
      "final_checks",
      "preflight",
      "mismatch_gate",
    ],
  },
  { id: "apply", label: "Applying translation", stageIds: ["apply"] },
];

function progressStepsForFlow(flow) {
  return flow === "single" ? SINGLE_ALIGNMENT_PROGRESS_STEPS : MULTI_ALIGNMENT_PROGRESS_STEPS;
}

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
  const isIndeterminate = isActive && progress?.status === "running" && percent <= 0;
  const fillStyle = isIndeterminate ? "" : ` style="width: ${roundedPercent}%"`;
  return `
    <li class="add-translation-progress__step${isActive ? " is-active" : ""}${isComplete ? " is-complete" : ""}${isIndeterminate ? " add-translation-progress__step--indeterminate" : ""}">
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
        <span class="add-translation-progress__bar-fill"${fillStyle}></span>
      </div>
    </li>
  `;
}

function resolveActiveProgressStepIndex(progress, steps) {
  const stageId = typeof progress?.stageId === "string" ? progress.stageId : "";
  if (!stageId) {
    return -1;
  }
  if (stageId === "preflight" && progress?.status !== "complete") {
    return steps.findIndex((step) => step.id === "prepare_units");
  }
  return steps.findIndex((step) => step.stageIds.includes(stageId));
}

function renderProgressModal(modal) {
  const progress = modal.progress ?? {};
  const steps = progressStepsForFlow(modal.flow);
  const activeIndex = resolveActiveProgressStepIndex(progress, steps);
  const detail = [progress.message, progressLabel(progress)].filter(Boolean).join(" ");
  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact modal-card--navigation-loading modal-card--add-translation-progress" role="dialog" aria-modal="true" aria-labelledby="project-add-translation-progress-modal-title" aria-busy="true" data-modal-dialog="project-add-translation:progress" tabindex="-1">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">Aligning and inserting</p>
          <h2 class="modal__title" id="project-add-translation-progress-modal-title">Please wait</h2>
          <p class="modal__supporting">Aligning your translation text with this file. This may take a few minutes.</p>
          <ol class="add-translation-progress" aria-label="Alignment and insertion progress">
            ${steps.map((step, index) => renderProgressStep(step, progress, index, activeIndex)).join("")}
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
      <section class="card modal-card modal-card--compact" role="dialog" aria-modal="true" aria-labelledby="project-add-translation-existing-modal-title" data-modal-dialog="project-add-translation:existing" tabindex="-1">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">EXISTING TRANSLATIONS</p>
          <h2 class="modal__title" id="project-add-translation-existing-modal-title">This language already has translation text</h2>
          <p class="modal__supporting">When you insert to this language, your text will only be inserted into the empty rows. It will not overwrite the existing translations. If you intend to insert for the entire file, cancel and delete the existing text first.</p>
          ${renderError(modal.error)}
          <div class="modal__actions">
            ${secondaryButton("Cancel", "cancel-project-add-translation", { modalCancel: true })}
            ${primaryButton("Insert to empty rows", "continue-project-add-translation-existing", {
              modalDefault: true,
            })}
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderMismatchModal(modal) {
  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact" role="dialog" aria-modal="true" aria-labelledby="project-add-translation-mismatch-modal-title" data-modal-dialog="project-add-translation:mismatch" tabindex="-1">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">TEXT MISMATCH</p>
          <h2 class="modal__title" id="project-add-translation-mismatch-modal-title">Inserted text does not match well</h2>
          <p class="modal__supporting">Much of the pasted text does not appear to match this file. If you continue, some parts may be inserted in the wrong place or left blank. Please review the result carefully.</p>
          ${renderError(modal.error)}
          <div class="modal__actions">
            ${secondaryButton("Cancel", "cancel-project-add-translation", { modalCancel: true })}
            ${primaryButton("Continue", "continue-project-add-translation-mismatch", {
              modalDefault: true,
            })}
          </div>
        </div>
      </section>
    </div>
  `;
}

export function renderProjectAddTranslationModal(state) {
  const modal = state.projectAddTranslation;
  const linkErrorMarkup = renderProjectDocumentLinkError(modal, {
    modalId: "project-add-translation",
    closeAction: "close-project-add-translation-link-error",
    retryAction: "retry-project-add-translation-link",
    invalidMessage: "Paste a valid Google Docs document link. Google Sheets, web pages, and local paths are not supported here.",
  });
  if (linkErrorMarkup) {
    return linkErrorMarkup;
  }
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
  return renderInputModal(modal);
}
