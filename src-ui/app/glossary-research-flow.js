// Glossary Research: user intent for the Research modal and the run view.
// The research itself is glossary-research-engine.js; this module wires it
// to the app (AI settings, texts, dictionary, local storage, live log).

import { state } from "./state.js";
import { invoke, listen } from "./runtime.js";
import { getAiProviderConfig } from "./ai-provider-config.js";
import { resolveAiActionProviderAndModel } from "./ai-settings-flow.js";
import { canManageGlossaries, selectedTeam } from "./glossary-shared.js";
import { selectedProjectsTeamInstallationId } from "./project-context.js";
import { findIsoLanguageOption, normalizeSupportedLanguageCode } from "../lib/language-options.js";
import {
  createGlossaryResearchReportState,
  createGlossaryResearchState,
} from "./glossary-research-state.js";
import {
  formatUsd,
  modelPrices,
  RESEARCH_PROVIDERS,
  researchProviderSupported,
} from "./glossary-research-budget.js";
import { createResearchEngine, RESEARCH_DEFAULTS, ResearchStop } from "./glossary-research-engine.js";
import { createProjectsCorpus, createSamaelCorpus } from "./glossary-research-corpus.js";
import { createDictionary, DICTIONARY_DOMAINS } from "./glossary-research-dictionary.js";
import { fold } from "./glossary-research-occurrences.js";

export const RESEARCH_STREAM_EVENT = "glossary-research-stream";
const MAX_LOG_EVENTS = 4000;
const STAGE_PROGRESS = {
  Dictionary: 0.05, "Word forms": 0.12, Sampling: 0.2, Discovery: 0.3,
  Proposal: 0.45, Review: 0.5, Counting: 0.55, Summary: 0.95, Done: 1,
};

let activeRun = null; // { engine, requestIds:Set, unlisten, store, context }
const streamHandlers = new Map();
let streamListener = null;

function research() {
  return state.glossaryResearch;
}

function languageName(code, fallback = "") {
  return findIsoLanguageOption(code)?.name ?? fallback ?? code;
}

function glossaryLanguages() {
  const editor = state.glossaryEditor ?? {};
  // Canonical codes ("zh-hant" -> "zh-Hant") so comparisons and lookups agree.
  const canonical = (code) => normalizeSupportedLanguageCode(code) || String(code ?? "");
  return {
    sourceCode: canonical(editor.sourceLanguage?.code),
    sourceName: editor.sourceLanguage?.name ?? languageName(editor.sourceLanguage?.code),
    targetCode: canonical(editor.targetLanguage?.code),
    targetName: editor.targetLanguage?.name ?? languageName(editor.targetLanguage?.code),
  };
}

// Project choices come from the app's search index of the projects stored on
// this Mac (the same texts research searches), not from the Projects page.
const projectOptionsByTeam = new Map();

/** Projects of the team, with whether any file has the glossary's source language. */
export function researchableProjects(sourceCode = glossaryLanguages().sourceCode) {
  const known = projectOptionsByTeam.get(`${state.selectedTeamId}:${sourceCode}`) ?? [];
  return known.map((project) => ({ id: project.projectId, title: project.title, hasLanguage: project.hasLanguage }));
}

let projectsLoad = null;

export function ensureResearchProjectsLoaded(render, { force = false } = {}) {
  const teamId = state.selectedTeamId;
  const installationId = selectedProjectsTeamInstallationId() ?? selectedTeam()?.installationId;
  const sourceCode = glossaryLanguages().sourceCode;
  const key = `${teamId}:${sourceCode}`;
  if (installationId == null || !sourceCode) return Promise.resolve();
  if (!force && projectOptionsByTeam.has(key)) return Promise.resolve();
  if (projectsLoad?.key === key) return projectsLoad.promise;
  const draft = research();
  if (draft) {
    draft.projectsLoading = true;
    draft.projectsError = "";
  }
  const promise = invoke("glossary_research_list_projects", { input: { installationId, languageCode: sourceCode } })
    .then((projects) => {
      projectOptionsByTeam.set(key, Array.isArray(projects) ? projects : []);
    })
    .catch((error) => {
      if (research()) research().projectsError = error?.message ?? String(error);
    })
    .finally(() => {
      if (research()) research().projectsLoading = false;
      projectsLoad = null;
      render();
    });
  projectsLoad = { key, promise };
  return promise;
}

/** The provider/model Research would use, or why it can't run. */
export function researchModelStatus() {
  const { providerId, modelId } = resolveAiActionProviderAndModel("research");
  const label = getAiProviderConfig(providerId)?.label ?? providerId;
  if (!researchProviderSupported(providerId)) {
    return { ok: false, providerId, modelId, providerLabel: label, reason: "provider" };
  }
  if (!modelId) return { ok: false, providerId, modelId, providerLabel: label, reason: "model" };
  if (!modelPrices(providerId, modelId)) {
    return { ok: false, providerId, modelId, providerLabel: label, reason: "price" };
  }
  return { ok: true, providerId, modelId, providerLabel: label };
}

export function supportedResearchProviderNames() {
  return RESEARCH_PROVIDERS.map((provider) => provider.name);
}

// --- opening the modal -------------------------------------------------------

export function openGlossaryResearch(render, { term = "", origin = null } = {}) {
  if (!canManageGlossaries(selectedTeam())) return;
  const languages = glossaryLanguages();
  const fresh = createGlossaryResearchState();
  const status = researchModelStatus();
  const originProject = origin?.projectId
    ? researchableProjects().find((project) => project.id === origin.projectId && project.hasLanguage)
    : null;
  state.glossaryResearch = {
    ...fresh,
    isOpen: true,
    step: status.ok ? "form" : "unsupported",
    unsupportedProviderName: status.ok ? "" : status.reason === "provider" ? status.providerLabel : `${status.providerLabel} (${status.modelId || "no model selected"})`,
    unsupportedReason: status.reason ?? "",
    term,
    reportLanguageCode: languages.targetCode || "en",
    sourceMode: languages.sourceCode === "es" ? "samael" : "projects",
    selectedProjectIds: languages.sourceCode === "es" || !originProject ? [] : [originProject.id],
    origin,
  };
  render();
  void loadPastRuns(render);
  void ensureResearchProjectsLoaded(render);
}

export function closeGlossaryResearch(render) {
  if (activeRun && ["running", "counting"].includes(research().runStatus)) {
    cancelGlossaryResearchRun(render);
  }
  const origin = research().origin;
  state.glossaryResearch = createGlossaryResearchState();
  if (origin?.returnToEditor && typeof origin.returnToEditor === "function") {
    origin.returnToEditor();
    return;
  }
  render();
}

// --- form fields (no re-render while typing) -----------------------------------

export function updateResearchField(field, value) {
  const draft = research();
  if (!draft?.isOpen) return;
  if (field === "sampleSize") draft.sampleSize = Math.max(1, Math.min(1000, Number.parseInt(value, 10) || 100));
  else if (field === "spendingLimitUsd") draft.spendingLimitUsd = Math.max(0.1, Number.parseFloat(value) || RESEARCH_DEFAULTS.spendingLimitUsd);
  else draft[field] = value;
  draft.formError = "";
}

export function updateResearchVariant(index, value) {
  const draft = research();
  if (draft?.isOpen && index >= 0 && index < draft.variants.length) draft.variants[index] = value;
}

export function addResearchVariant(render) {
  research().variants.push("");
  render();
  requestAnimationFrame?.(() => {
    const inputs = document.querySelectorAll("[data-research-variant-input]");
    inputs[inputs.length - 1]?.focus();
  });
}

export function removeResearchVariant(render, index) {
  research().variants.splice(index, 1);
  render();
}

export function setResearchReportLanguage(render, code) {
  const draft = research();
  draft.reportLanguageCode = code;
  draft.reportLanguagePickerOpen = false;
  render();
}

export function openResearchLanguagePicker(render) {
  const draft = research();
  draft.reportLanguagePickerOpen = true;
  draft.reportLanguagePickerSelection = draft.reportLanguageCode;
  render();
}

export function selectResearchPickerLanguage(render, code) {
  research().reportLanguagePickerSelection = code;
  render();
}

export function closeResearchLanguagePicker(render, apply) {
  const draft = research();
  if (apply && draft.reportLanguagePickerSelection) draft.reportLanguageCode = draft.reportLanguagePickerSelection;
  draft.reportLanguagePickerOpen = false;
  render();
}

export function setResearchSourceMode(render, mode) {
  const draft = research();
  draft.sourceMode = mode;
  draft.formError = "";
  if (mode === "projects" && !draft.selectedProjectIds.length) {
    openResearchProjectPicker(render);
    return;
  }
  render();
}

export function openResearchProjectPicker(render) {
  const draft = research();
  draft.projectPickerOpen = true;
  draft.projectPickerDraft = [...draft.selectedProjectIds];
  render();
  void ensureResearchProjectsLoaded(render, { force: true });
}

export function toggleResearchPickerProject(render, projectId) {
  const draft = research();
  const selected = new Set(draft.projectPickerDraft);
  if (selected.has(projectId)) selected.delete(projectId);
  else selected.add(projectId);
  draft.projectPickerDraft = [...selected];
  render();
}

/** Select every project, or clear the selection when all are already selected. */
export function toggleAllResearchPickerProjects(render) {
  const draft = research();
  const ids = researchableProjects().map((project) => project.id);
  const allSelected = ids.length > 0 && ids.every((id) => draft.projectPickerDraft.includes(id));
  draft.projectPickerDraft = allSelected ? [] : ids;
  render();
}

export function closeResearchProjectPicker(render, apply) {
  const draft = research();
  if (apply) draft.selectedProjectIds = [...draft.projectPickerDraft];
  draft.projectPickerOpen = false;
  if (!draft.selectedProjectIds.length && glossaryLanguages().sourceCode === "es") draft.sourceMode = "samael";
  render();
}

export function toggleResearchAdvanced(render) {
  research().advancedOpen = !research().advancedOpen;
  render();
}

// --- starting --------------------------------------------------------------------

function researchForms(draft) {
  return [draft.term, ...draft.variants].map((value) => value.trim()).filter(Boolean);
}

/** Existing glossary entries whose source terms match the term or a variant. */
export function findExistingResearchEntries(forms, terms = state.glossaryEditor?.terms ?? []) {
  const wanted = new Set(forms.map((form) => fold(form).trim()));
  return terms.filter((term) => (term.sourceTerms ?? []).some((source) => wanted.has(fold(source).trim())));
}

export function startGlossaryResearch(render) {
  const draft = research();
  if (!draft.term.trim()) {
    draft.formError = "Enter the term to research.";
    render();
    return;
  }
  if (draft.sourceMode === "projects") {
    const chosen = researchableProjects().filter((project) => draft.selectedProjectIds.includes(project.id));
    if (!chosen.length) {
      draft.formError = "Select at least one project.";
      render();
      return;
    }
    if (!chosen.some((project) => project.hasLanguage)) {
      draft.formError = `None of the files in the selected projects contain ${glossaryLanguages().sourceName}, the glossary's source language.`;
      render();
      return;
    }
  }
  if (draft.step === "form") {
    draft.existingMatches = findExistingResearchEntries(researchForms(draft));
    if (draft.existingMatches.length) {
      draft.step = "existing";
      render();
      return;
    }
  }
  void beginResearchRun(render);
}

export function backToResearchForm(render) {
  research().step = "form";
  render();
}

function newRunId(term) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const slug = fold(term).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "term";
  return `${stamp}_${slug}`;
}

function createRunStore({ installationId, glossaryId, runId, initial = {} }) {
  const data = { ...initial };
  let chain = Promise.resolve();
  return {
    data,
    load: (name) => data[name],
    save(name, value) {
      data[name] = value;
      chain = chain
        .then(() => invoke("save_glossary_research_stage", {
          input: { installationId, glossaryId, runId, stage: name, value: value ?? null },
        }))
        .catch(() => {
          // Storage failures must not stop research; the log shows them.
          appendLog({ type: "problem", text: `Could not save the ${name} checkpoint on this computer.` });
        });
    },
    flush: () => chain,
  };
}

function ensureStreamListener() {
  if (streamListener || typeof listen !== "function") return;
  streamListener = listen(RESEARCH_STREAM_EVENT, (event) => {
    const payload = event?.payload ?? {};
    streamHandlers.get(payload.requestId)?.(payload.kind, payload.delta ?? "");
  });
}

function createAppModel({ installationId, providerId, modelId, requestIds }) {
  ensureStreamListener();
  return {
    async call(request, onDelta) {
      streamHandlers.set(request.requestId, onDelta);
      requestIds.add(request.requestId);
      try {
        const outcome = await invoke("run_glossary_research_request", {
          request: {
            installationId, providerId, modelId, requestId: request.requestId,
            instructions: request.instructions, content: request.content,
            schemaName: request.schemaName, schema: request.schema, effort: request.effort,
            maxOutputTokens: request.maxOutputTokens,
            webSearchDomains: request.webSearchDomains ?? null,
          },
        });
        return { ...outcome, billedUnknown: outcome.billedUnknown ?? outcome.billed_unknown ?? false };
      } finally {
        streamHandlers.delete(request.requestId);
        requestIds.delete(request.requestId);
      }
    },
  };
}

function engineSettings(draft, languages) {
  return {
    term: draft.term.trim(),
    variants: draft.variants.map((value) => value.trim()).filter(Boolean),
    existingEntries: draft.existingMatches.map((term) => ({
      termId: term.termId, sourceTerms: term.sourceTerms ?? [], targetTerms: term.targetTerms ?? [],
      targetVariantNotes: term.targetVariantNotes ?? [], notesToTranslators: term.notesToTranslators ?? "",
    })),
    sourceLanguageName: languages.sourceName,
    sourceLanguageCode: languages.sourceCode,
    targetLanguageName: languages.targetName,
    targetLanguageCode: languages.targetCode,
    reportLanguageName: languageName(draft.reportLanguageCode, draft.reportLanguageCode),
    sampleSize: draft.sampleSize,
    spendingLimitUsd: draft.spendingLimitUsd,
    seed: draft.seed || "1",
    webDictionaryDomains: DICTIONARY_DOMAINS,
  };
}

async function beginResearchRun(render, resume = null) {
  const draft = research();
  const team = selectedTeam();
  const installationId = selectedProjectsTeamInstallationId() ?? team?.installationId;
  const glossaryId = state.glossaryEditor?.glossaryId;
  const languages = glossaryLanguages();
  const status = researchModelStatus();
  if (!status.ok) {
    draft.step = "unsupported";
    render();
    return;
  }
  const runId = resume?.runId ?? newRunId(draft.term);
  const store = createRunStore({ installationId, glossaryId, runId, initial: resume?.stages ?? {} });
  const meta = resume?.stages?.meta ?? {
    runId, term: draft.term.trim(), variants: draft.variants.filter((v) => v.trim()),
    glossaryId, glossaryTitle: state.glossaryEditor?.title ?? "",
    sourceLanguage: { code: languages.sourceCode, name: languages.sourceName },
    targetLanguage: { code: languages.targetCode, name: languages.targetName },
    reportLanguage: { code: draft.reportLanguageCode, name: languageName(draft.reportLanguageCode) },
    sourceMode: draft.sourceMode, projectIds: draft.selectedProjectIds,
    sampleSize: draft.sampleSize, spendingLimitUsd: draft.spendingLimitUsd, seed: draft.seed || "1",
    providerId: status.providerId, modelId: status.modelId,
    existingTermIds: draft.existingMatches.map((term) => term.termId),
    settings: engineSettings(draft, languages),
    startedAt: new Date().toISOString(), status: "running",
  };
  meta.settings.spendingLimitUsd = draft.spendingLimitUsd;
  store.save("meta", meta);

  const projects = researchableProjects().filter((project) => meta.projectIds.includes(project.id));
  const corpus = meta.sourceMode === "samael"
    ? createSamaelCorpus()
    : createProjectsCorpus({ invoke, installationId, projects, languageCode: languages.sourceCode, targetLanguageCode: languages.targetCode });
  const requestIds = new Set();
  const engine = createResearchEngine({
    model: createAppModel({ installationId, providerId: status.providerId, modelId: status.modelId, requestIds }),
    prices: modelPrices(status.providerId, status.modelId),
    corpus,
    dictionary: createDictionary({ languageCode: languages.sourceCode, invoke }),
    store,
    log: (event) => onEngineLog(render, event),
    settings: meta.settings,
  });
  activeRun = { engine, requestIds, store, runId, glossaryId, installationId, meta };
  Object.assign(draft, {
    step: "run", runId, runStatus: "running", stageLabel: "Starting", progress: 0.01,
    spent: engine.budget.spent, limit: engine.budget.limit, runError: "", stopKind: "",
    log: resume?.stages?.log ?? [],
  });
  render();
  try {
    const result = await engine.runToReview();
    if (activeRun?.runId !== runId) return;
    draft.runStatus = "review";
    draft.proposalDraft = structuredClone(result.proposal);
    meta.status = "review";
    store.save("meta", meta);
  } catch (error) {
    handleRunStop(render, error, store, meta);
  }
  draft.spent = engine.budget.spent;
  store.save("log", draft.log);
  render();
}

function handleRunStop(render, error, store, meta) {
  const draft = research();
  const kind = error instanceof ResearchStop || error?.kind ? error.kind : "failed";
  draft.runStatus = kind === "cancelled" ? "stopped" : "failed";
  draft.stopKind = kind;
  draft.runError = kind === "budget"
    ? `The spending limit was reached. ${error.message} Finished work is saved; raise the limit to continue.`
    : error.message ?? String(error);
  appendLog({ type: "problem", text: draft.runError });
  meta.status = draft.runStatus;
  meta.error = draft.runError;
  store.save("meta", meta);
}

export function cancelGlossaryResearchRun(render) {
  if (!activeRun) return;
  activeRun.engine.cancel();
  for (const requestId of activeRun.requestIds) {
    void invoke("cancel_glossary_research_request", { requestId }).catch(() => {});
  }
  research().runStatus = "stopped";
  appendLog({ type: "problem", text: "Cancelled. Finished work is saved on this computer." });
  render();
}

// --- live log --------------------------------------------------------------------

function appendLog(event) {
  const draft = research();
  if (!draft) return null;
  const last = draft.log.at(-1);
  const isDelta = event.type === "answer-delta" || event.type === "thinking";
  if (isDelta && last && last.type === event.type && last.requestId === event.requestId) {
    last.text += event.text;
    return last;
  }
  if (event.type === "answer" && draft.log.some((item) => item.type === "answer-delta" && item.requestId === event.requestId)) {
    return null; // already streamed
  }
  const entry = { type: event.type, text: String(event.text ?? ""), requestId: event.requestId ?? null, at: Date.now() };
  if (event.instructions) entry.instructions = event.instructions;
  if (event.type === "usage") {
    const r = event.record;
    entry.text = `${r.stage}: ${r.status}, ${r.inputTokens ?? "?"} in (${r.cachedTokens ?? 0} cached), `
      + `${r.outputTokens ?? "?"} out (${r.reasoningTokens ?? 0} thinking), ${formatUsd(r.costUsd)}`
      + `${r.costIsEstimate ? " (reserved; outcome unknown)" : ""}, ${r.seconds.toFixed(1)} s — total ${formatUsd(event.spent)} of ${formatUsd(event.limit)}`;
    draft.spent = event.spent;
  }
  if (event.type === "request") entry.text = `→ ${event.stage}${event.purpose ? `: ${event.purpose}` : ""}\n${entry.text}`;
  draft.log.push(entry);
  if (draft.log.length > MAX_LOG_EVENTS) draft.log.splice(0, draft.log.length - MAX_LOG_EVENTS);
  return entry;
}

let pendingRender = null;
function onEngineLog(render, event) {
  const draft = research();
  const entry = appendLog(event);
  if (event.type === "heading") {
    draft.stageLabel = event.text;
    draft.progress = STAGE_PROGRESS[event.text] ?? draft.progress;
  }
  // Streamed text goes straight into the visible log; everything else
  // re-renders at most ~8 times a second.
  if (entry && appendLogToDom(entry)) return;
  if (pendingRender) return;
  pendingRender = setTimeout(() => {
    pendingRender = null;
    renderKeepingLogPinned(render);
  }, 120);
}

function logContainer() {
  return typeof document !== "undefined" ? document.querySelector("[data-research-log]") : null;
}

function appendLogToDom(entry) {
  const container = logContainer();
  if (!container || !(entry.type === "answer-delta" || entry.type === "thinking")) return false;
  const pinned = container.scrollTop + container.clientHeight >= container.scrollHeight - 24;
  let line = container.lastElementChild;
  if (!line || line.dataset.logRequest !== String(entry.requestId) || line.dataset.logType !== entry.type) {
    line = document.createElement("div");
    line.className = `research-log__line research-log__line--${entry.type}`;
    line.dataset.logRequest = String(entry.requestId);
    line.dataset.logType = entry.type;
    container.appendChild(line);
  }
  line.textContent = entry.text;
  if (pinned) container.scrollTop = container.scrollHeight;
  return true;
}

export function renderKeepingLogPinned(render) {
  const before = logContainer();
  const pinned = !before || before.scrollTop + before.clientHeight >= before.scrollHeight - 24;
  render();
  const after = logContainer();
  if (after && pinned) after.scrollTop = after.scrollHeight;
}

// --- review and counting -------------------------------------------------------------

export function updateResearchProposalField(path, value) {
  const proposal = research()?.proposalDraft;
  if (!proposal) return;
  const [entryIndex, field, variantIndex, variantField] = path;
  const entry = proposal.entries[entryIndex];
  if (!entry) return;
  if (field === "sourceTerms") {
    entry.sourceTerms = value.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
  } else if (field === "generalNote") {
    entry.generalNote = value;
  } else if (field === "variants" && entry.variants[variantIndex]) {
    entry.variants[variantIndex][variantField] = value;
  }
  research().reviewError = "";
}

export function addResearchProposalVariant(render, entryIndex) {
  const entry = research().proposalDraft.entries[entryIndex];
  const used = new Set(entry.variants.map((variant) => variant.id));
  let n = entry.variants.length + 1;
  while (used.has(`${entry.id}v${n}`)) n += 1;
  entry.variants.push({ id: `${entry.id}v${n}`, target: "", note: "", senses: [], corpusSense: null, fromExisting: false, rationale: "Added during review." });
  render();
}

export function removeResearchProposalVariant(render, entryIndex, variantIndex) {
  research().proposalDraft.entries[entryIndex].variants.splice(variantIndex, 1);
  render();
}

export function removeResearchProposalEntry(render, entryIndex) {
  research().proposalDraft.entries.splice(entryIndex, 1);
  render();
}

export async function countGlossaryResearch(render) {
  const draft = research();
  if (!activeRun || !draft.proposalDraft) return;
  const proposal = structuredClone(draft.proposalDraft);
  for (const entry of proposal.entries) {
    entry.variants = entry.variants.filter((variant) => variant.target.trim());
  }
  const { engine, store, meta } = activeRun;
  draft.runStatus = "counting";
  draft.reviewError = "";
  meta.status = "counting";
  store.save("meta", meta);
  render();
  try {
    await engine.runCounting(proposal);
    meta.status = "done";
    meta.finishedAt = new Date().toISOString();
    meta.spentUsd = engine.budget.spent;
    store.save("meta", meta);
    draft.runStatus = "done";
    draft.progress = 1;
  } catch (error) {
    if (/cannot be counted/.test(error.message)) {
      draft.runStatus = "review";
      draft.reviewError = error.message;
    } else {
      handleRunStop(render, error, store, meta);
    }
  }
  draft.spent = engine.budget.spent;
  store.save("log", draft.log);
  await store.flush();
  render();
}

// --- past runs ------------------------------------------------------------------

export async function loadPastRuns(render) {
  const installationId = selectedProjectsTeamInstallationId() ?? selectedTeam()?.installationId;
  const glossaryId = state.glossaryEditor?.glossaryId;
  if (installationId == null || !glossaryId) return;
  try {
    const runs = await invoke("list_glossary_research_runs", { installationId, glossaryId });
    if (research()?.isOpen) {
      research().pastRuns = runs.filter((run) => run.meta);
      render();
    }
  } catch {
    // history is optional
  }
}

export async function resumeGlossaryResearchRun(render, runId) {
  const installationId = selectedProjectsTeamInstallationId() ?? selectedTeam()?.installationId;
  const glossaryId = state.glossaryEditor?.glossaryId;
  const stages = await invoke("load_glossary_research_run", { installationId, glossaryId, runId });
  const meta = stages.meta;
  if (!meta) return;
  const draft = research();
  Object.assign(draft, {
    term: meta.term, variants: meta.variants ?? [], reportLanguageCode: meta.reportLanguage?.code,
    sourceMode: meta.sourceMode, selectedProjectIds: meta.projectIds ?? [], sampleSize: meta.sampleSize,
    spendingLimitUsd: Math.max(draft.spendingLimitUsd, meta.spendingLimitUsd ?? 0), seed: meta.seed,
    existingMatches: (state.glossaryEditor?.terms ?? []).filter((term) => (meta.existingTermIds ?? []).includes(term.termId)),
  });
  if (stages.proposal && !stages.aggregate) {
    await beginResearchRun(render, { runId, stages });
    if (stages.confirmedProposal) research().proposalDraft = structuredClone(stages.confirmedProposal);
    return;
  }
  await beginResearchRun(render, { runId, stages });
}

export function resetGlossaryResearchReport() {
  state.glossaryResearchReport = createGlossaryResearchReportState();
}

export function activeResearchRun() {
  return activeRun;
}
