import {
  escapeHtml,
  primaryButton,
  secondaryButton,
  tooltipAttributes,
} from "../lib/ui.js";
import { isoLanguageOptions, findIsoLanguageOption } from "../lib/language-options.js";
import {
  researchableProjects,
  supportedResearchProviderNames,
} from "../app/glossary-research-flow.js";
import { researchModelsWithPrices } from "../app/glossary-research-budget.js";

const esc = escapeHtml;

function languageName(code) {
  return findIsoLanguageOption(code)?.name ?? code;
}

function modal(name, title, body, actions, extraClass = "", eyebrow = "Glossary research") {
  return `
    <div class="modal-backdrop">
      <section class="card modal-card research-modal ${extraClass}" role="dialog" aria-modal="true" aria-labelledby="${esc(name)}-title" data-modal-dialog="${esc(name)}" tabindex="-1">
        <div class="card__body modal-card__body">
          <p class="card__eyebrow">${esc(eyebrow)}</p>
          <h2 class="modal__title" id="${esc(name)}-title">${esc(title)}</h2>
          ${body}
          <div class="modal__actions">${actions}</div>
        </div>
      </section>
    </div>`;
}

// --- form ---------------------------------------------------------------------

function renderVariantRows(research) {
  const rows = research.variants.map((value, index) => `
    <div class="research-variant-row">
      <input class="field__input" type="text" value="${esc(value)}"
        data-research-variant-input data-variant-index="${index}"
        aria-label="Variant or alternative spelling ${index + 1}" />
      <button class="term-variant-row__action-button term-variant-row__action-button--remove" type="button"
        data-action="remove-research-variant:${index}" aria-label="Remove this variant"
        ${tooltipAttributes("Remove this variant")}>
        <span class="term-variant-row__remove-icon" aria-hidden="true"></span>
      </button>
    </div>`).join("");
  return `
    ${rows}
    <div class="research-add-variant">
      <button class="term-lane__add-button" type="button" data-action="add-research-variant"
        aria-label="Add variant or alternative spelling">
        <span class="term-lane__add-icon" aria-hidden="true"></span>
      </button>
      <span class="research-add-variant__label">add variant or alternative spelling</span>
    </div>`;
}

function renderReportLanguage(research, targetCode) {
  const quick = [...new Set([targetCode, "es", "en"].filter(Boolean))];
  const current = research.reportLanguageCode;
  const codes = quick.includes(current) ? quick : [...quick, current];
  const segments = codes.map((code) => {
    const active = code === current;
    return `<button type="button" class="segmented-control__button${active ? " is-active" : ""}" role="radio"
      aria-checked="${active}" data-action="set-research-report-language:${esc(code)}">${esc(languageName(code))}</button>`;
  }).join("");
  return `
    <div class="field">
      <span class="field__label">Report language</span>
      <div class="research-inline">
        <div class="segmented-control" role="radiogroup" aria-label="Report language">${segments}</div>
        <button type="button" class="text-action" data-action="open-research-language-picker">Show all…</button>
      </div>
    </div>`;
}

function renderSourceTexts(research, sourceCode) {
  const samaelAllowed = sourceCode === "es";
  const projects = researchableProjects(sourceCode);
  const chosen = projects.filter((project) => research.selectedProjectIds.includes(project.id));
  const names = chosen.map((project) => project.title).join(", ");
  const option = (mode, label) => {
    const active = research.sourceMode === mode;
    return `<button type="button" class="segmented-control__button${active ? " is-active" : ""}" role="radio"
      aria-checked="${active}" data-action="set-research-source-mode:${mode}">${esc(label)}</button>`;
  };
  return `
    <div class="field">
      <span class="field__label">Source texts</span>
      <div class="segmented-control research-source-control" role="radiogroup" aria-label="Source texts">
        ${samaelAllowed ? option("samael", "Complete works of Samael Aun Weor") : ""}
        ${option("projects", "Select projects")}
      </div>
      ${research.sourceMode === "projects" ? `
        <div class="research-projects-line">
          <span class="research-projects-summary${chosen.length ? "" : " is-empty"}" title="${esc(names)}">${esc(names || "No projects selected")}</span>
          <button type="button" class="text-action" data-action="open-research-project-picker">${chosen.length ? "Change…" : "Choose projects…"}</button>
        </div>` : ""}
    </div>`;
}

function renderAdvanced(research) {
  const chevron = `<svg class="research-disclosure__chevron" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1.5 6.5 5 3 8.5" /></svg>`;
  return `
    <div class="research-disclosure${research.advancedOpen ? " is-open" : ""}">
      <button type="button" class="research-disclosure__toggle" data-action="toggle-research-advanced" aria-expanded="${research.advancedOpen}">${chevron}Advanced</button>
      ${research.advancedOpen ? `
        <div class="research-advanced__grid">
          <label class="field">
            <span class="field__label">Sample size</span>
            <input class="field__input" type="number" min="1" max="1000" value="${esc(research.sampleSize)}" data-research-field="sampleSize" />
          </label>
          <label class="field">
            <span class="field__label">Spending limit (US$)</span>
            <input class="field__input" type="number" min="0.1" step="0.5" value="${esc(research.spendingLimitUsd)}" data-research-field="spendingLimitUsd" />
          </label>
          <label class="field">
            <span class="field__label">Random seed</span>
            <input class="field__input" type="text" value="${esc(research.seed)}" data-research-field="seed" />
          </label>
        </div>
        <p class="modal__supporting research-small">Sample size is the number of passages judged (all of them when there are fewer). The run stops before any AI request that could go over the spending limit.</p>` : ""}
    </div>`;
}

function renderPastRuns(research) {
  const runs = research.pastRuns ?? [];
  if (!runs.length) return "";
  return `
    <details class="research-past">
      <summary>Past research on this glossary (${runs.length})</summary>
      <ul class="research-past__list">
        ${runs.slice(0, 20).map((run) => {
          const meta = run.meta;
          const done = meta.status === "done";
          return `<li>
            <span><strong>${esc(meta.term)}</strong> → ${esc(meta.targetLanguage?.name ?? "")} · ${esc((meta.startedAt ?? "").slice(0, 10))} · ${esc(meta.status)}${meta.spentUsd != null ? ` · $${Number(meta.spentUsd).toFixed(2)}` : ""}</span>
            ${done
              ? `<button type="button" class="button button--secondary button--compact" data-action="open-research-report:${esc(run.runId)}">Open report</button>`
              : `<button type="button" class="button button--secondary button--compact" data-action="resume-research-run:${esc(run.runId)}">Resume</button>`}
          </li>`;
        }).join("")}
      </ul>
    </details>`;
}

function renderForm(state) {
  const research = state.glossaryResearch;
  const sourceCode = state.glossaryEditor?.sourceLanguage?.code ?? "";
  const targetCode = state.glossaryEditor?.targetLanguage?.code ?? "";
  const body = `
    <p class="modal__supporting">Find what a ${esc(languageName(sourceCode))} word means in your texts and which ${esc(languageName(targetCode))} translations fit. You review the proposed translations before anything is counted, and nothing changes in the glossary until you save an entry.</p>
    <div class="modal__form">
      <div class="field">
        <label class="field__label" for="research-term-input">Enter the term to research</label>
        <input id="research-term-input" class="field__input" type="text" value="${esc(research.term)}" data-research-field="term" data-modal-initial-focus />
        <div class="research-variants">${renderVariantRows(research)}</div>
      </div>
      ${renderReportLanguage(research, targetCode)}
      ${renderSourceTexts(research, sourceCode)}
      ${renderAdvanced(research)}
      ${research.formError ? `<p class="modal__error" role="alert">${esc(research.formError)}</p>` : ""}
      ${renderPastRuns(research)}
    </div>`;
  return modal("glossary-research", "Research a term", body,
    `${secondaryButton("Cancel", "close-glossary-research", { modalCancel: true })}
     ${primaryButton("Start research", "start-glossary-research", { modalDefault: true })}`);
}

function renderUnsupported(state) {
  const research = state.glossaryResearch;
  const providers = supportedResearchProviderNames().join(", ");
  const text = research.unsupportedReason === "provider"
    ? `${research.unsupportedProviderName} does not support this feature. To use this glossary research tool, please use one of the following AI providers: ${providers}`
    : `${research.unsupportedProviderName} can't be used for research: Gnosis TMS doesn't know this model's prices, so it can't keep research within its spending limit. On the AI Settings page, choose one of these models for Research: ${researchModelsWithPrices("claude").concat(researchModelsWithPrices("openai")).join(", ")}.`;
  return modal("glossary-research", "Research isn\u2019t available", `<p class="modal__supporting">${esc(text)}</p>`,
    primaryButton("OK", "close-glossary-research", { modalDefault: true }));
}

function renderExisting(state) {
  const research = state.glossaryResearch;
  const entries = research.existingMatches.map((term) => `
    <li class="research-existing__entry">
      <div><strong>${esc((term.sourceTerms ?? []).join(" / "))}</strong> → ${esc((term.targetTerms ?? []).join(", "))}</div>
      ${(term.targetVariantNotes ?? []).some(Boolean) ? `<ul>${(term.targetTerms ?? []).map((target, index) => term.targetVariantNotes?.[index] ? `<li>${esc(target)}: ${esc(term.targetVariantNotes[index])}</li>` : "").join("")}</ul>` : ""}
      ${term.notesToTranslators ? `<div class="muted">Note: ${esc(term.notesToTranslators)}</div>` : ""}
    </li>`).join("");
  const body = `
    <p class="modal__supporting">The glossary already has ${research.existingMatches.length === 1 ? "an entry" : "entries"} for this term:</p>
    <ul class="research-existing">${entries}</ul>
    <p class="modal__supporting">If you continue, the research starts from the existing entry and measures its translations along with new candidates. You can review the results and choose, entry by entry, whether to update the existing entry or keep it.</p>`;
  return modal("glossary-research", "This term is already in the glossary", body,
    `${secondaryButton("Cancel", "back-to-research-form", { modalCancel: true })}
     ${primaryButton("Continue", "start-glossary-research", { modalDefault: true })}`);
}

// --- run view -----------------------------------------------------------------------

function renderLogEntry(entry) {
  const text = esc(entry.text);
  switch (entry.type) {
    case "heading":
      return `<div class="research-log__heading">${text}</div>`;
    case "fact":
      return `<div class="research-log__fact"><strong>${text}</strong></div>`;
    case "problem":
      return `<div class="research-log__problem"><strong>${text}</strong></div>`;
    case "usage":
      return `<div class="research-log__usage">${text}</div>`;
    case "request":
      return `<div class="research-log__line research-log__line--request">${text}${entry.instructions ? `<details class="research-log__instructions"><summary>instructions sent with this request</summary>${esc(entry.instructions)}</details>` : ""}</div>`;
    case "thinking":
      return `<div class="research-log__line research-log__line--thinking" data-log-request="${esc(entry.requestId)}" data-log-type="thinking">${text}</div>`;
    case "answer-delta":
    case "answer":
      return `<div class="research-log__line research-log__line--answer-delta" data-log-request="${esc(entry.requestId)}" data-log-type="answer-delta">${text}</div>`;
    default:
      return `<div class="research-log__line">${text}</div>`;
  }
}

function renderReview(research, targetName) {
  const proposal = research.proposalDraft;
  if (!proposal) return "";
  const entries = proposal.entries.map((entry, entryIndex) => `
    <section class="research-review__entry">
      <header class="research-review__entry-head">
        <span class="research-tag">${entry.kind === "expression" ? "Expression entry" : "Entry"}</span>
        <button type="button" class="text-action" data-action="remove-research-entry:${entryIndex}">Remove entry</button>
      </header>
      <label class="field">
        <span class="field__label">Source terms (comma-separated)</span>
        <input class="field__input" type="text" value="${esc(entry.sourceTerms.join(", "))}" data-research-proposal="${entryIndex}:sourceTerms" />
      </label>
      <label class="field">
        <span class="field__label">General note (${esc(targetName)})</span>
        <textarea class="field__input" rows="2" data-research-proposal="${entryIndex}:generalNote">${esc(entry.generalNote)}</textarea>
      </label>
      <div class="research-review__variants">
        ${entry.variants.map((variant, variantIndex) => `
          <div class="research-review__variant">
            <input class="field__input" type="text" value="${esc(variant.target)}" aria-label="Translation" data-research-proposal="${entryIndex}:variants:${variantIndex}:target" />
            <textarea class="field__input" rows="2" aria-label="Usage note" data-research-proposal="${entryIndex}:variants:${variantIndex}:note">${esc(variant.note)}</textarea>
            <button class="term-variant-row__action-button term-variant-row__action-button--remove" type="button"
              data-action="remove-research-proposal-variant:${entryIndex}:${variantIndex}" aria-label="Remove this translation">
              <span class="term-variant-row__remove-icon" aria-hidden="true"></span>
            </button>
            ${variant.fromExisting ? `<span class="research-tag research-tag--existing">existing</span>` : ""}
            ${variant.rationale ? `<p class="research-review__why">${esc(variant.rationale)}</p>` : ""}
          </div>`).join("")}
        <div class="research-add-variant">
          <button class="term-lane__add-button" type="button" data-action="add-research-proposal-variant:${entryIndex}" aria-label="Add translation">
            <span class="term-lane__add-icon" aria-hidden="true"></span>
          </button>
          <span class="research-add-variant__label">add translation</span>
        </div>
      </div>
    </section>`).join("");
  return `
    <div class="research-review">
      <p class="modal__supporting"><strong>Review the proposed translations.</strong> Edit, add or remove them; notes must stay in ${esc(targetName)}. Counting starts only when you click Count.</p>
      ${entries}
      ${research.reviewError ? `<p class="modal__error" role="alert">${esc(research.reviewError)}</p>` : ""}
    </div>`;
}

function renderRun(state) {
  const research = state.glossaryResearch;
  const targetName = state.glossaryEditor?.targetLanguage?.name ?? "target language";
  const running = research.runStatus === "running" || research.runStatus === "counting";
  const pct = Math.round((research.progress ?? 0) * 100);
  const statusText = {
    running: research.stageLabel || "Working",
    counting: "Counting",
    review: "Waiting for your review",
    done: "Research finished",
    stopped: "Stopped",
    failed: "Stopped",
  }[research.runStatus] ?? research.runStatus;
  const head = `
    <div class="research-run__head">
      <div class="research-run__status"><strong>${esc(statusText)}</strong> · $${Number(research.spent ?? 0).toFixed(3)} of $${Number(research.limit ?? 0).toFixed(2)}</div>
      <div class="research-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>
    </div>`;
  const stoppedPanel = (research.runStatus === "failed" || research.runStatus === "stopped")
    ? `<div class="research-stopped">
         <p class="modal__error" role="alert">${esc(research.runError || "Research was stopped.")}</p>
         ${research.stopKind === "budget" ? `
           <label class="field research-stopped__limit">
             <span class="field__label">New spending limit (US$)</span>
             <input class="field__input" type="number" min="0.1" step="0.5" value="${esc(research.spendingLimitUsd)}" data-research-field="spendingLimitUsd" />
           </label>` : ""}
       </div>`
    : "";
  const review = research.runStatus === "review" ? renderReview(research, targetName) : "";
  const log = `<div class="research-log" data-research-log aria-live="off">${research.log.map(renderLogEntry).join("")}</div>`;
  let actions;
  if (running) {
    actions = secondaryButton("Cancel", "cancel-glossary-research-run", { modalCancel: true });
  } else if (research.runStatus === "review") {
    actions = `${secondaryButton("Cancel", "close-glossary-research", { modalCancel: true })}
      ${primaryButton("Count", "count-glossary-research", { modalDefault: true })}`;
  } else if (research.runStatus === "done") {
    actions = `${secondaryButton("Close", "close-glossary-research", { modalCancel: true })}
      ${primaryButton("Open report", `open-research-report:${research.runId}`, { modalDefault: true })}`;
  } else {
    actions = `${secondaryButton("Close", "close-glossary-research", { modalCancel: true })}
      ${primaryButton("Resume", `resume-research-run:${research.runId}`, { modalDefault: true })}`;
  }
  return modal("glossary-research", `Research: ${research.term}`,
    `${head}${stoppedPanel}${review}${log}`, actions, "research-modal--run");
}

// --- nested pickers ----------------------------------------------------------------

function renderProjectPicker(state) {
  const research = state.glossaryResearch;
  const sourceCode = state.glossaryEditor?.sourceLanguage?.code ?? "";
  const projects = researchableProjects(sourceCode);
  const selected = new Set(research.projectPickerDraft);
  const rows = projects.length
    ? projects.map((project) => `
      <label class="research-project-row${project.hasLanguage ? "" : " is-muted"}">
        <input type="checkbox" data-action="toggle-research-picker-project:${esc(project.id)}" ${selected.has(project.id) ? "checked" : ""} />
        <span>${esc(project.title)}</span>
        ${project.hasLanguage ? "" : `<span class="muted">no ${esc(languageName(sourceCode))} files</span>`}
      </label>`).join("")
    : `<p class="modal__supporting">This team has no projects yet.</p>`;
  return `
    <div class="modal-backdrop modal-backdrop--nested-picker">
      <section class="card modal-card research-modal" role="dialog" aria-modal="true" aria-label="Select projects" data-modal-dialog="glossary-research-projects" tabindex="-1">
        <div class="card__body modal-card__body">
        <h2 class="modal__title">Select projects</h2>
        <p class="modal__supporting">Research searches the ${esc(languageName(sourceCode))} text of the projects you select. Files without ${esc(languageName(sourceCode))} are ignored.</p>
        <div class="research-project-list">${rows}</div>
        <div class="modal__actions">
          ${secondaryButton("Cancel", "cancel-research-project-picker", { modalCancel: true })}
          ${primaryButton("Done", "confirm-research-project-picker", { modalDefault: true })}
        </div>
        </div>
      </section>
    </div>`;
}

function renderLanguagePicker(state) {
  const research = state.glossaryResearch;
  const selected = research.reportLanguagePickerSelection;
  const options = isoLanguageOptions.map((language) => `
    <button type="button" class="research-language-option${language.code === selected ? " is-selected" : ""}" role="option"
      aria-selected="${language.code === selected}" data-action="select-research-picker-language:${esc(language.code)}">${esc(language.name)}</button>`).join("");
  return `
    <div class="modal-backdrop modal-backdrop--nested-picker">
      <section class="card modal-card research-modal" role="dialog" aria-modal="true" aria-label="Report language" data-modal-dialog="glossary-research-language" tabindex="-1">
        <div class="card__body modal-card__body">
        <h2 class="modal__title">Report language</h2>
        <div class="research-language-list" role="listbox" aria-label="Languages">${options}</div>
        <div class="modal__actions">
          ${secondaryButton("Cancel", "cancel-research-language-picker", { modalCancel: true })}
          ${primaryButton("Select", "confirm-research-language-picker", { modalDefault: true })}
        </div>
        </div>
      </section>
    </div>`;
}

export function renderGlossaryResearchModal(state) {
  const research = state.glossaryResearch;
  if (!research?.isOpen) return "";
  let main;
  if (research.step === "unsupported") main = renderUnsupported(state);
  else if (research.step === "existing") main = renderExisting(state);
  else if (research.step === "run") main = renderRun(state);
  else main = renderForm(state);
  return main
    + (research.projectPickerOpen ? renderProjectPicker(state) : "")
    + (research.reportLanguagePickerOpen ? renderLanguagePicker(state) : "");
}
