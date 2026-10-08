import {
  escapeHtml,
  primaryButton,
  secondaryButton,
  tooltipAttributes,
} from "../lib/ui.js";
import { findIsoLanguageOption } from "../lib/language-options.js";
import { renderLanguagePickerModal } from "./language-picker-modal.js";
import { renderMoneyInput } from "./money-input.js";
import {
  researchableProjects,
  researchFamilyTotal,
  supportedResearchProviderNames,
} from "../app/glossary-research-flow.js";
import { batchSpent } from "../app/glossary-research-family-budget.js";
import { formatUsd, researchModelsWithPrices } from "../app/glossary-research-budget.js";
import { buildLogSections, isRequestRunning, liveRequest } from "../app/glossary-research-log-view.js";
import { renderLivePanel, renderResults, renderStageLine } from "./glossary-research-log-render.js";

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
            <span class="field__label">Spending limit</span>
            ${renderMoneyInput({ value: research.spendingLimitUsd, inputAttributes: 'data-research-field="spendingLimitUsd"', ariaLabel: "Spending limit in US dollars" })}
          </label>
        </div>
        <label class="research-checkbox">
          <input type="checkbox" data-research-field="pauseForReview" ${research.pauseForReview ? "checked" : ""} />
          <span>Pause to review the proposed translations before counting</span>
        </label>
        <p class="modal__supporting research-small">Sample size is the maximum number of paragraphs of source text containing the research term to be considered for research. The run stops before any AI request that could go over the spending limit.</p>` : ""}
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
            <span><strong>${esc(meta.term)}</strong> → ${esc(meta.targetLanguage?.name ?? "")} · ${esc((meta.startedAt ?? "").slice(0, 10))} · ${esc(meta.status)}${meta.spentUsd != null ? ` · ${formatUsd(meta.spentUsd)}` : ""}</span>
            ${done
              ? `<span class="research-past__actions">
                  ${meta.settings?.familyBatch ? "" : `<button type="button" class="button button--secondary button--compact" data-action="research-related-words:${esc(run.runId)}">Related words</button>`}
                  <button type="button" class="button button--secondary button--compact" data-action="open-research-report:${esc(run.runId)}">Open report</button>
                </span>`
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
    <p class="modal__supporting">Find what a ${esc(languageName(sourceCode))} word means in your texts and which ${esc(languageName(targetCode))} translations fit. Nothing changes in the glossary until you save an entry from the report.</p>
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

function renderReview(research, targetName, targetCode) {
  const proposal = research.proposalDraft;
  if (!proposal) return "";
  const relatedWord = Boolean(research.familyQueue) && research.term !== research.familyQueue.headword;
  const entries = proposal.entries.map((entry, entryIndex) => `
    <section class="research-review__entry">
      <h3 class="research-review__entry-title">${esc(entry.sourceTerms[0] ?? "")}${entry.kind === "expression" ? ' <span class="research-review__hint">expression</span>' : ""}</h3>
      <ul class="research-review__list">
        ${entry.variants.map((variant, variantIndex) => `
          <li class="research-review__item">
            <span lang="${esc(targetCode)}">${esc(variant.target)}</span>
            <button class="term-variant-row__action-button term-variant-row__action-button--remove" type="button"
              data-action="remove-research-proposal-variant:${entryIndex}:${variantIndex}" aria-label="Remove ${esc(variant.target)}"
              ${tooltipAttributes("Remove", { align: "end" })}>
              <span class="term-variant-row__remove-icon" aria-hidden="true"></span>
            </button>
          </li>`).join("")}
      </ul>
      <div class="research-review__add" data-modal-enter-action="add-research-variant-text:${entryIndex}">
        <input class="field__input" type="text" placeholder="Add a translation" aria-label="Add a translation"
          value="${esc(entry.addDraft ?? "")}" data-research-proposal="${entryIndex}:addDraft" />
        ${secondaryButton("Add", `add-research-variant-text:${entryIndex}`)}
      </div>
    </section>`).join("");
  return `
    <div class="research-review">
      <p class="modal__supporting">${relatedWord
        ? "Below is a list of terms related to your original research term."
        : "Below is your research term."} For each of them, we have a list of possible translations. In the next step, we will count how many times each of them would actually be the most appropriate translation when translating the actual corpus texts. Based on these results, we will identify the most important translations and eliminate the less useful ones. Before we do the count, please review the candidate translations. Remove the ones you don't want the AI to consider and add any new ones that you would like to suggest.</p>
      ${entries}
      ${research.reviewError ? `<p class="modal__error" role="alert">${esc(research.reviewError)}</p>` : ""}
    </div>`;
}

function renderFamilyChoice(research) {
  const kinds = { prefixed: "prefixed", suffixed: "suffixed", compound: "compound", phrase: "phrase" };
  const rows = (research.familyGroups ?? []).map((group, index) => `
    <label class="research-project-row">
      <input type="checkbox" data-action="toggle-research-family:${index}" ${research.familyTicked?.[index] ? "checked" : ""} />
      <span>${esc(group.forms.join(", "))}</span>
      <span class="muted">${esc(kinds[group.kind] ?? group.kind)} · ${group.rows} passages</span>
    </label>`).join("");
  const anyTicked = (research.familyTicked ?? []).some(Boolean);
  return `
    <div class="research-family">
      <p class="modal__supporting">These related words occur in the texts. Each word you tick is researched after “${esc(research.term)}”, one after another, as its own glossary entry, and is checked against the translations found before it.</p>
      <div class="research-project-list">${rows}</div>
      ${anyTicked ? `
        <div class="research-family__limits">
          <p class="modal__supporting">Spending limit for “${esc(research.term)}”: ${formatUsd(research.limit)}. A related word that reaches its own limit stops and can be resumed later; the others go on. The total limit covers everything, “${esc(research.term)}” included, and stops the rest when reached.</p>
          <div class="research-advanced__row">
            <label class="field">
              <span class="field__label">Limit per related word</span>
              ${renderMoneyInput({ value: research.familyWordLimitUsd, inputAttributes: 'data-research-field="familyWordLimitUsd"', ariaLabel: "Spending limit per related word in US dollars" })}
            </label>
            <label class="field">
              <span class="field__label">Total limit</span>
              ${renderMoneyInput({ value: researchFamilyTotal(research), inputAttributes: 'data-research-field="familyTotalLimitUsd"', ariaLabel: "Total spending limit in US dollars" })}
            </label>
          </div>
          ${research.familyLimitError ? `<p class="modal__error" role="alert">${esc(research.familyLimitError)}</p>` : ""}
        </div>` : ""}
    </div>`;
}

function renderRun(state) {
  const research = state.glossaryResearch;
  const targetName = state.glossaryEditor?.targetLanguage?.name ?? "target language";
  const running = research.runStatus === "running" || research.runStatus === "counting";
  const statusText = {
    running: research.stageLabel || "Working",
    counting: "Counting",
    review: "Waiting for your review",
    family: "Related words",
    done: "Research finished",
    stopped: "Stopped",
    failed: "Stopped",
  }[research.runStatus] ?? research.runStatus;
  const head = `
    <div class="research-run__head">
      ${renderStageLine({ stepLabel: research.stageLabel, runStatus: research.runStatus })}
      <div class="research-run__status"><strong>${esc(statusText)}</strong><span class="research-run__cost">${formatUsd(research.spent)} of ${formatUsd(research.limit)}</span></div>
      ${research.familyQueue ? `<p class="muted">${research.familyQueue.words.length ? `Then, one after another: ${esc(research.familyQueue.words.map((word) => word.form).join(", "))} · ` : ""}related words ${formatUsd(batchSpent(research.familyQueue))} spent of ${formatUsd(research.familyQueue.totalLimit)} in all</p>` : ""}
    </div>`;
  const budgetStop = research.stopKind === "budget";
  const stoppedPanel = (research.runStatus === "failed" || research.runStatus === "stopped")
    ? `<div class="modal__error research-stopped" role="alert">
         <p class="research-stopped__message">${esc(research.runError || "Research was stopped.")}</p>
         ${budgetStop ? `
           <div class="research-stopped__raise">
             <label class="research-stopped__limit">
               <span>New spending limit</span>
               ${renderMoneyInput({ value: research.raiseLimitTo, inputAttributes: 'data-research-field="raiseLimitTo"', ariaLabel: "New spending limit in US dollars" })}
             </label>
             ${primaryButton("Raise limit and continue", "raise-research-limit")}
           </div>
           ${research.raiseLimitError ? `<p class="research-stopped__message">${esc(research.raiseLimitError)}</p>` : ""}` : ""}
       </div>`
    : "";
  const review = research.runStatus === "review"
    ? renderReview(research, targetName, state.glossaryEditor?.targetLanguage?.code ?? "")
    : research.runStatus === "family" ? renderFamilyChoice(research) : "";
  const sections = buildLogSections(research.log);
  const shown = liveRequest(sections, research.liveChoice, research.liveFollow);
  // The panel keeps following one request until it finishes.
  research.liveFollow = shown && isRequestRunning(shown) ? shown.requestId : null;
  const livePanel = renderLivePanel({ sections, request: shown, running, open: research.liveOpen !== false });
  const logLines = `<div class="research-results" data-research-log aria-live="off">${renderResults(sections, {
    running, openSections: research.sectionOpen ?? {}, openExchanges: research.exchangeOpen ?? {},
  })}</div>`;
  // While research runs the log is the main view; afterwards it folds away.
  const log = running
    ? logLines
    : `<div class="research-disclosure${research.logOpen ? " is-open" : ""}">
        <button type="button" class="research-disclosure__toggle" data-action="toggle-research-log" aria-expanded="${research.logOpen === true}">
          <svg class="research-disclosure__chevron" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1.5 6.5 5 3 8.5" /></svg>Research log
        </button>
        ${research.logOpen ? logLines : ""}
      </div>`;
  const logArea = `${log}${livePanel}`;
  let actions;
  if (running) {
    actions = secondaryButton("Cancel", "cancel-glossary-research-run", { modalCancel: true });
  } else if (research.runStatus === "family") {
    actions = `${secondaryButton("Cancel", "cancel-glossary-research-run", { modalCancel: true })}
      ${primaryButton("Continue", "continue-research-family", { modalDefault: true })}`;
  } else if (research.runStatus === "review") {
    actions = `${secondaryButton("Cancel", "close-glossary-research", { modalCancel: true })}
      ${primaryButton("Count", "count-glossary-research", { modalDefault: true })}`;
  } else if (research.runStatus === "done") {
    actions = `${secondaryButton("Close", "close-glossary-research", { modalCancel: true })}
      ${primaryButton("Open report", `open-research-report:${research.runId}`, { modalDefault: true })}`;
  } else if (budgetStop) {
    actions = secondaryButton("Close", "close-glossary-research", { modalCancel: true });
  } else {
    actions = `${secondaryButton("Close", "close-glossary-research", { modalCancel: true })}
      ${primaryButton("Resume", `resume-research-run:${research.runId}`, { modalDefault: true })}`;
  }
  return modal("glossary-research", `Research: ${research.term}`,
    `${head}${stoppedPanel}${review}${logArea}`, actions, "research-modal--run");
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
    : research.projectsLoading
      ? `<div class="research-projects-loading" aria-busy="true" aria-live="polite">
          <p class="modal__supporting">Loading the list of projects.</p>
          <div class="navigation-loading-modal__spinner research-projects-loading__spinner" aria-hidden="true"></div>
        </div>`
      : research.projectsError
        ? `<p class="modal__error" role="alert">${esc(research.projectsError)}</p>`
        : `<p class="modal__supporting">No projects are stored on this computer for this team yet. Open a project once so its files are downloaded, then try again.</p>`;
  return `
    <div class="modal-backdrop modal-backdrop--nested-picker">
      <section class="card modal-card research-modal" role="dialog" aria-modal="true" aria-label="Select projects" data-modal-dialog="glossary-research-projects" tabindex="-1">
        <div class="card__body modal-card__body">
        <h2 class="modal__title">Select projects</h2>
        <p class="modal__supporting">Research searches the ${esc(languageName(sourceCode))} text of the projects you select. Files without ${esc(languageName(sourceCode))} are ignored.</p>
        ${projects.length ? `
          <div class="research-project-toolbar">
            <button type="button" class="button button--secondary button--compact" data-action="toggle-all-research-picker-projects">${projects.every((project) => selected.has(project.id)) ? "Deselect all" : "Select all"}</button>
            ${projects.some((project) => !project.hasLanguage) ? `<span class="muted">Projects without ${esc(languageName(sourceCode))} files are skipped.</span>` : ""}
          </div>` : ""}
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
  const targetName = state.glossaryEditor?.targetLanguage?.name ?? "the target language";
  return renderLanguagePickerModal({
    dialogName: "glossary-research-language",
    titleId: "glossary-research-language-title",
    eyebrow: "REPORT LANGUAGE",
    title: "Choose the report language",
    supporting: `The report's headings, explanations and recommendations are written in this language. Proposed translations and usage notes stay in ${targetName}.`,
    listLabel: "Report language",
    listAttribute: "data-research-language-list",
    selectedCode: research.reportLanguagePickerSelection,
    selectAction: "select-research-picker-language",
    nested: true,
    actionsHtml: `
      ${secondaryButton("Cancel", "cancel-research-language-picker", { modalCancel: true })}
      ${primaryButton("Select", "confirm-research-language-picker", { modalDefault: true, disabled: !research.reportLanguagePickerSelection })}`,
  });
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
