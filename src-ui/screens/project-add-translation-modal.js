import { escapeHtml, primaryButton, secondaryButton } from "../lib/ui.js";
import { formatErrorForDisplay } from "../app/error-display.js";
import { pickerSelectedCode, renderLanguagePickerModal } from "./language-picker-modal.js";
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
  const uploadOnly = modal.requiresSrtFile === true;
  return renderProjectDocumentInputModal(modal, {
    uploadOnly,
    modalId: "project-add-translation",
    eyebrow: "ADD TRANSLATIONS",
    title: uploadOnly ? "Add subtitle translation" : "Add translation text",
    supportingText: uploadOnly
      ? "Upload an SRT file to align the translation using subtitle timestamps."
      : "Choose how to provide the translation for this entire file. The text will be automatically aligned and inserted.",
    modeAriaLabel: "Add translation method",
    selectModeAction: "select-project-add-translation-input-mode",
    selectFileAction: "select-project-add-translation-file",
    submitLinkAction: "submit-project-add-translation-link",
    submitPasteAction: "submit-project-add-translation-paste",
    cancelAction: "cancel-project-add-translation",
    dropzoneAttribute: "data-project-add-translation-dropzone",
    dropzoneLabel: uploadOnly ? "Drop one SRT file here or click to open the file selector." : "Drop one file here or click to open the file selector.",
    uploadHint: uploadOnly
      ? "A valid .srt file is required for subtitle chapters."
      : "Supported formats: .txt, .docx, .rtf, or .srt. Only plain text is added; the existing chapter keeps its formatting and timing.",
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

function renderLanguageModal(modal) {
  const selectedCode = pickerSelectedCode(modal.targetLanguageCode);
  return renderLanguagePickerModal({
    dialogName: "project-add-translation:language",
    titleId: "project-add-translation-language-modal-title",
    eyebrow: "TRANSLATION LANGUAGE",
    title: "What language is this translation?",
    supporting: "Select the language of the translation text.",
    beforeListHtml: renderError(modal.error),
    listLabel: "Translation language",
    listAttribute: "data-project-add-translation-language-list",
    selectedCode,
    selectAction: "select-project-add-translation-language",
    actionsHtml: `
            ${secondaryButton("Cancel", "cancel-project-add-translation", { modalCancel: true })}
            ${primaryButton("Continue", "continue-project-add-translation-language", {
              disabled: !selectedCode,
              modalDefault: true,
            })}`,
  });
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
  if (flow === "subtitleOverlap") return [
    { id: "match_timestamps", label: "Matching start times", stageIds: ["match_timestamps"] },
    { id: "match_overlap", label: "Matching overlapping subtitles", stageIds: ["match_overlap"] },
    { id: "check_meaning", label: "Checking subtitle meanings", stageIds: ["check_meaning"] },
    { id: "apply", label: "Adding subtitle translation", stageIds: ["apply"] },
  ];
  if (flow === "subtitle") return [
    { id: "validate_subtitles", label: "Checking SRT format", stageIds: ["validate_subtitles"] },
    { id: "match_timestamps", label: "Matching start times", stageIds: ["match_timestamps"] },
    { id: "apply", label: "Adding subtitle translation", stageIds: ["apply"] },
  ];
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
          <p class="card__eyebrow">${modal.flow?.startsWith("subtitle") ? "Adding subtitle translation" : "Aligning and inserting"}</p>
          <h2 class="modal__title" id="project-add-translation-progress-modal-title">Please wait</h2>
          <p class="modal__supporting">${modal.flow?.startsWith("subtitle")
            ? "Matching exact start times and inserting unmatched subtitles in time order."
            : "Aligning your translation text with this file. This may take a few minutes."}</p>
          <ol class="add-translation-progress" aria-label="Alignment and insertion progress">
            ${steps.map((step, index) => renderProgressStep(step, progress, index, activeIndex)).join("")}
          </ol>
          ${detail ? `<p class="modal__supporting add-translation-progress__detail">${escapeHtml(detail)}</p>` : ""}
          ${renderError(modal.error)}
          <div class="modal__actions">
            ${secondaryButton(modal.status === "canceling" ? "Canceling..." : "Cancel", "cancel-project-add-translation", {
              modalCancel: true,
              disabled: modal.status === "canceling" || progress.stageId === "apply",
            })}
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderApplyErrorModal(modal) {
  const retryLabel = modal.applyErrorKind === "sourceChanged" ? "Restart alignment" : "Retry";
  return `
    <div class="modal-backdrop">
      <section class="card modal-card modal-card--compact" role="dialog" aria-modal="true" aria-labelledby="project-add-translation-error-title" data-modal-dialog="project-add-translation:error" tabindex="-1">
        <div class="card__body modal-card__body">
          <h2 class="modal__title" id="project-add-translation-error-title">Translation could not be applied</h2>
          <p class="modal__supporting">Your translation text is still available. You can retry alignment.</p>
          ${renderError(modal.error)}
          <div class="modal__actions">
            ${secondaryButton("Cancel", "cancel-project-add-translation", { modalCancel: true })}
            ${primaryButton(retryLabel, "retry-project-add-translation-apply", { modalDefault: true })}
          </div>
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
  if (modal.subtitleMismatch) {
    const mismatch = modal.subtitleMismatch;
    const percent = Number(mismatch.unmatchedPercent).toLocaleString(undefined, { maximumFractionDigits: 3 });
    const stage = mismatch.stage ?? "exact";
    const examples = Array.isArray(mismatch.examples) ? mismatch.examples : [];
    const messages = {
      exact: `For ${percent}% of the subtitles you are adding, there is no subtitle in the original file that starts at the same time. Since Gnosis TMS shares the timing between both languages, this will make a mess of your file. We can attempt to fix this by matching each subtitle in the new file with the nearest time subtitle in the old file, but that will cause you to lose the timing data in the new file. Do you want to try it anyway?`,
      overlap: `Even with this looser matching criteria, ${percent}% of your new subtitles still didn't match up with the original file. This will be a messy match. Do you still want to continue?`,
      meaning: "We have checked the old subtitles against the new ones you are aligning and we found that many of them don't look like they have the same meaning. Here are some examples:",
    };
    return `
      <div class="modal-backdrop">
        <section class="card modal-card modal-card--compact" role="dialog" aria-modal="true" aria-labelledby="project-add-translation-subtitle-mismatch-title" data-modal-dialog="project-add-translation:subtitle-mismatch" tabindex="-1">
          <div class="card__body modal-card__body">
            <p class="card__eyebrow">SUBTITLE ${stage === "meaning" ? "MEANING" : "TIMESTAMP"} MISMATCH</p>
            <h2 class="modal__title" id="project-add-translation-subtitle-mismatch-title">${stage === "meaning" ? "These subtitles may not match" : "Subtitle timestamps don’t match"}</h2>
            <p class="modal__supporting">${escapeHtml(messages[stage] ?? messages.exact)}</p>
            ${stage === "meaning" ? `
              <ol class="subtitle-meaning-examples">${examples.map((pair) => `
                <li>
                  <p><strong>Original subtitle ${Number(pair.sourceLine)}:</strong> ${escapeHtml(pair.sourceText)}</p>
                  <p><strong>New subtitle ${Number(pair.targetLine)}:</strong> ${escapeHtml(pair.targetText)}</p>
                </li>`).join("")}</ol>
              <p class="modal__supporting">We recommend you cancel the alignment procedure and re-examine your subtitles to find out why they don't match up because saving this could make a mess of your existing file.</p>` : ""}
            <div class="modal__actions">
              ${secondaryButton("Cancel", "cancel-project-add-translation", { modalCancel: true, modalInitialFocus: true })}
              ${primaryButton(stage === "meaning" ? "Save (not recommended)" : "Continue", "continue-project-add-translation-mismatch")}
            </div>
          </div>
        </section>
      </div>`;
  }
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
  if (modal.step === "applyError") {
    return renderApplyErrorModal(modal);
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
