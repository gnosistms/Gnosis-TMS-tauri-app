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
  BudgetExceededError,
  formatUsd,
  modelPrices,
  RESEARCH_PROVIDERS,
  researchProviderSupported,
} from "./glossary-research-budget.js";
import { createResearchEngine, ResearchStop } from "./glossary-research-engine.js";
import {
  buildLogView,
  isRequestOpen,
  requestState,
  requestStatusText,
} from "./glossary-research-log-view.js";
import { createProjectsCorpus, createSamaelCorpus } from "./glossary-research-corpus.js";
import { createDictionary, DICTIONARY_DOMAINS } from "./glossary-research-dictionary.js";
import { createLanguageData } from "./glossary-research-frequency.js";
import { fold } from "./glossary-research-occurrences.js";
import { parseMoneyValue } from "./money-input.js";
import { maybeStartGlossaryBackgroundSync } from "./glossary-background-sync.js";

export const RESEARCH_STREAM_EVENT = "glossary-research-stream";
export const RESEARCH_DATA_PROGRESS_EVENT = "glossary-research-data-progress";
const MAX_LOG_EVENTS = 4000;
const STAGE_PROGRESS = {
  Dictionary: 0.04, "Word forms": 0.08, "Word family": 0.11, Sampling: 0.14, "Where the term comes from": 0.18,
  "Parts and frequency": 0.23, "Candidate translations": 0.28, "Candidate checks": 0.32, Discovery: 0.36,
  Proposal: 0.43, "Existing glossary entry": 0.46, "Shared translations": 0.48, Review: 0.5, Counting: 0.52, "Counting (second judge)": 0.72,
  "Rare translations": 0.92, Summary: 0.95, Done: 1,
};

let activeRun = null; // { engine, requestIds:Set, unlisten, store, context }
let activeRunCleanup = null;
let pendingFamilyChoice = null; // resolves the engine's question about related words

/** Download progress of a language's frequency data, as log lines (one per ~10 MB). */
function listenForDataDownloads(render) {
  activeRunCleanup?.();
  const shown = new Map();
  let unlisten = null;
  let stopped = false;
  if (typeof listen !== "function") return () => {};
  Promise.resolve(listen(RESEARCH_DATA_PROGRESS_EVENT, (event) => {
    const { language, file, received, total } = event.payload ?? {};
    const key = `${language}/${file}`;
    const step = Math.floor((received ?? 0) / (10 * 1024 * 1024));
    const finished = total && received >= total;
    if (!finished && shown.get(key) === step) return;
    shown.set(key, step);
    const mb = (bytes) => `${Math.round((bytes ?? 0) / (1024 * 1024))} MB`;
    onEngineLog(render, { type: "info", text: finished ? `Downloaded ${file} (${mb(received)}).` : `Downloading ${file}: ${mb(received)} of ${mb(total)}…` });
  })).then((fn) => {
    unlisten = fn;
    if (stopped) unlisten?.();
  }).catch(() => {});
  return () => {
    stopped = true;
    unlisten?.();
  };
}
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
  if (activeRun && ["running", "counting", "family"].includes(research().runStatus)) {
    cancelGlossaryResearchRun(render);
  }
  const origin = research().origin;
  state.glossaryResearch = createGlossaryResearchState();
  if (origin?.returnToEditor && typeof origin.returnToEditor === "function") {
    origin.returnToEditor();
    return;
  }
  render();
  // Glossary sync is held while research is open; catch up now.
  void maybeStartGlossaryBackgroundSync(render);
}

// --- form fields (no re-render while typing) -----------------------------------

export function updateResearchField(field, value) {
  const draft = research();
  if (!draft?.isOpen) return;
  if (field === "raiseLimitTo") draft.raiseLimitTo = parseMoneyValue(value) ?? draft.raiseLimitTo;
  else if (field === "sampleSize") draft.sampleSize = Math.max(1, Math.min(1000, Number.parseInt(value, 10) || 100));
  else if (field === "spendingLimitUsd") draft.spendingLimitUsd = parseMoneyValue(value) ?? draft.spendingLimitUsd;
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

export function toggleResearchLog(render) {
  research().logOpen = !research().logOpen;
  renderKeepingLogPinned(render);
}

/** Grow note boxes to fit their text (called after renders and while typing). */
function sizeResearchTextareas(root) {
  const textareas = [...(root?.querySelectorAll?.("[data-research-autosize]") ?? [])];
  if (!textareas.length) return;
  // Measuring briefly shrinks each box, which shortens the window and would
  // pull its scroll position up; put the scroll position back afterwards.
  const scroller = textareas[0].closest(".modal-card");
  const scrollTop = scroller?.scrollTop ?? 0;
  for (const textarea of textareas) {
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight + 2}px`;
  }
  if (scroller && scroller.scrollTop !== scrollTop) scroller.scrollTop = scrollTop;
}

let resizeListening = false;

export function syncResearchTextareaHeights(root = globalThis.document) {
  if (!root?.querySelector?.("[data-research-autosize]")) return;
  sizeResearchTextareas(root);
  // Wrapping changes once web fonts finish loading, after layout settles, and
  // when the window is resized; measure again then.
  globalThis.requestAnimationFrame?.(() => sizeResearchTextareas(root));
  globalThis.document?.fonts?.ready?.then(() => sizeResearchTextareas(root));
  if (!resizeListening && globalThis.window?.addEventListener) {
    resizeListening = true;
    globalThis.window.addEventListener("resize", () => sizeResearchTextareas(globalThis.document));
  }
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
    reportLanguageCode: draft.reportLanguageCode,
    sampleSize: draft.sampleSize,
    spendingLimitUsd: draft.spendingLimitUsd,
    seed: draft.seed || "1",
    pauseForReview: draft.pauseForReview === true,
    webDictionaryDomains: DICTIONARY_DOMAINS,
    judges: 2,
    frequencyChecks: true,
  };
}

async function beginResearchRun(render, resume = null, family = null) {
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
    settings: { ...engineSettings(draft, languages), ...(family ?? {}) },
    startedAt: new Date().toISOString(), status: "running",
  };
  meta.settings.spendingLimitUsd = draft.spendingLimitUsd;
  meta.spendingLimitUsd = draft.spendingLimitUsd;
  store.save("meta", meta);

  const projects = researchableProjects().filter((project) => meta.projectIds.includes(project.id));
  const corpus = meta.sourceMode === "samael"
    ? createSamaelCorpus()
    : createProjectsCorpus({ invoke, installationId, projects, languageCode: languages.sourceCode, targetLanguageCode: languages.targetCode });
  const requestIds = new Set();
  const languageData = createLanguageData({ invoke });
  const stopProgress = listenForDataDownloads(render);
  const engine = createResearchEngine({
    model: createAppModel({ installationId, providerId: status.providerId, modelId: status.modelId, requestIds }),
    prices: modelPrices(status.providerId, status.modelId),
    corpus,
    dictionary: createDictionary({ languageCode: languages.sourceCode, invoke }),
    store,
    log: (event) => onEngineLog(render, event),
    settings: meta.settings,
    languageData,
    glossaryTerms: (state.glossaryEditor?.terms ?? []).map((term) => ({
      sourceTerms: term.sourceTerms ?? [], targetTerms: term.targetTerms ?? [],
      notes: term.targetVariantNotes ?? [], note: term.notesToTranslators ?? "",
    })),
    chooseFamily: ({ groups }) => new Promise((resolve) => {
      Object.assign(research(), { runStatus: "family", familyGroups: groups, familyTicked: groups.map((group) => group.suggested) });
      pendingFamilyChoice = resolve;
      render();
    }),
  });
  activeRunCleanup = stopProgress;
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
    if (!meta.settings.familyBatch && result.familyWords?.length && !draft.familyQueue) {
      draft.familyQueue = {
        headword: meta.term, words: structuredClone(result.familyWords), siblings: [],
        familyForms: [...(store.load("forms")?.confirmed ?? []), ...result.familyWords.flatMap((word) => word.forms)],
      };
    }
  } catch (error) {
    handleRunStop(render, error, store, meta);
  }
  draft.spent = engine.budget.spent;
  store.save("log", draft.log);
  render();
  // Counting follows straight away unless the person asked to review first.
  // Runs saved before this setting existed always paused, and still do.
  if (draft.runStatus === "review" && meta.settings?.pauseForReview === false && !resume?.stages?.confirmedProposal) {
    await countGlossaryResearch(render);
  }
}

function handleRunStop(render, error, store, meta) {
  const draft = research();
  const kind = error instanceof BudgetExceededError
    ? "budget"
    : error instanceof ResearchStop || error?.kind ? error.kind : "failed";
  draft.runStatus = kind === "cancelled" ? "stopped" : "failed";
  draft.stopKind = kind;
  draft.runError = kind === "budget"
    ? `The spending limit was reached. ${error.message} Finished work is saved.`
    : error.message ?? String(error);
  if (kind === "budget") {
    const limit = Number(draft.spendingLimitUsd) || Number(draft.limit) || 0;
    draft.raiseLimitTo = Math.round(limit * 2 * 100) / 100;
  }
  appendLog({ type: "problem", text: draft.runError });
  meta.status = draft.runStatus;
  meta.error = draft.runError;
  store.save("meta", meta);
}

export function cancelGlossaryResearchRun(render) {
  if (!activeRun) return;
  research().familyQueue = null;
  if (pendingFamilyChoice) {
    pendingFamilyChoice(null);
    pendingFamilyChoice = null;
  }
  activeRun.engine.cancel();
  for (const requestId of activeRun.requestIds) {
    void invoke("cancel_glossary_research_request", { requestId }).catch(() => {});
  }
  research().runStatus = "stopped";
  appendLog({ type: "problem", text: "Cancelled. Finished work is saved on this computer." });
  render();
}

// --- live log --------------------------------------------------------------------

/** Exported for tests: add one engine log event to the research log. */
export function appendResearchLogEvent(event) {
  return appendLog(event);
}

/** Exported for tests: handle one engine log event as a running research does. */
export function receiveResearchLogEvent(render, event) {
  onEngineLog(render, event);
}

function appendLog(event) {
  const draft = research();
  if (!draft) return null;
  const isDelta = event.type === "answer-delta" || event.type === "thinking";
  if (isDelta) {
    // Several requests stream at once: each request keeps one thinking entry
    // and one answer entry, and new text is added to that entry.
    const existing = findStreamEntry(draft.log, event.requestId, event.type);
    if (existing) {
      existing.text += event.text;
      return existing;
    }
  }
  if (event.type === "answer" && draft.log.some((item) => item.type === "answer-delta" && item.requestId === event.requestId)) {
    return null; // already streamed
  }
  const entry = { type: event.type, text: String(event.text ?? ""), requestId: event.requestId ?? null, at: Date.now() };
  if (event.instructions) entry.instructions = event.instructions;
  if (event.type === "request") {
    entry.stage = event.stage;
    entry.purpose = event.purpose ?? "";
    if (event.batch) entry.batch = event.batch;
  }
  if (event.type === "usage") {
    const r = event.record;
    entry.record = r;
    entry.text = `${r.stage}: ${r.status}, ${r.inputTokens ?? "?"} in (${r.cachedTokens ?? 0} cached), `
      + `${r.outputTokens ?? "?"} out (${r.reasoningTokens ?? 0} thinking), ${formatUsd(r.costUsd)}`
      + `${r.costIsEstimate ? " (reserved; outcome unknown)" : ""}, ${r.seconds.toFixed(1)} s — total ${formatUsd(event.spent)} of ${formatUsd(event.limit)}`;
    draft.spent = event.spent;
  }
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
  if (entry && updateStreamInDom(entry)) return;
  if (pendingRender) return;
  pendingRender = setTimeout(() => {
    pendingRender = null;
    renderKeepingLogPinned(render);
  }, 120);
}

function logContainer() {
  return typeof document !== "undefined" ? document.querySelector("[data-research-log]") : null;
}

function findStreamEntry(log, requestId, type) {
  for (let index = log.length - 1; index >= 0; index -= 1) {
    const item = log[index];
    if (item.requestId === requestId && item.type === type) return item;
  }
  return null;
}

function findLogRequest(requestId) {
  const own = research().log.filter((item) => item.requestId === requestId);
  return buildLogView(own)
    .flatMap((item) => (item.kind === "batch" ? item.requests : item.kind === "request" ? [item.request] : []))[0] ?? null;
}

/**
 * Update one request's status line (and its text, when it is open) without a
 * full render. Returns false when the page must render instead: the request
 * is not on screen yet, its state just changed, or an open request has just
 * started a new kind of text.
 */
function updateStreamInDom(entry) {
  const container = logContainer();
  if (!container || !(entry.type === "answer-delta" || entry.type === "thinking")) return false;
  const card = container.querySelector(`[data-log-request-card="${CSS.escape(String(entry.requestId))}"]`);
  const request = card ? findLogRequest(entry.requestId) : null;
  if (!request || card.dataset.logRequestState !== requestState(request)) return false;
  const block = card.querySelector(`[data-log-type="${entry.type}"]`);
  if (!block && card.dataset.logRequestOpen === "true") return false;
  const pinned = container.scrollTop + container.clientHeight >= container.scrollHeight - 24;
  const status = card.querySelector("[data-log-request-status]");
  if (status) status.textContent = requestStatusText(request, formatUsd);
  if (block) block.textContent = entry.text;
  if (pinned) container.scrollTop = container.scrollHeight;
  return true;
}

export function toggleResearchRequest(render, requestId) {
  const draft = research();
  const request = findLogRequest(requestId);
  if (!request) return;
  draft.requestOpen = { ...(draft.requestOpen ?? {}), [requestId]: !isRequestOpen(request, draft.requestOpen) };
  render();
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
  } else if (field === "addDraft") {
    entry.addDraft = value;
  } else if (field === "variants" && entry.variants[variantIndex]) {
    entry.variants[variantIndex][variantField] = value;
  }
  research().reviewError = "";
}

/** Add the translation typed in an entry's "Add a translation" box. */
export function addResearchProposalVariantText(render, entryIndex) {
  const entry = research().proposalDraft?.entries[entryIndex];
  const target = String(entry?.addDraft ?? "").trim();
  if (!entry || !target) return;
  if (!entry.variants.some((variant) => variant.target.trim().toLowerCase() === target.toLowerCase())) {
    const used = new Set(entry.variants.map((variant) => variant.id));
    let n = entry.variants.length + 1;
    while (used.has(`${entry.id}v${n}`)) n += 1;
    entry.variants.push({ id: `${entry.id}v${n}`, target, note: "", senses: [], corpusSense: null, fromExisting: false, rationale: "Added during review." });
  }
  entry.addDraft = "";
  render();
  globalThis.requestAnimationFrame?.(() => globalThis.document?.querySelector(`[data-research-proposal="${entryIndex}:addDraft"]`)?.focus());
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
    delete entry.addDraft;
  }
  // An entry whose translations were all removed is not counted.
  proposal.entries = proposal.entries.filter((entry) => entry.variants.length);
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
    if (draft.familyQueue) queueSiblings(draft.familyQueue, store);
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
  if (draft.runStatus === "done" && draft.familyQueue) await researchNextFamilyWord(render);
}

// --- related words, researched one after another ---------------------------------

export function toggleResearchFamilyWord(render, index) {
  const draft = research();
  if (!draft.familyTicked || index < 0 || index >= draft.familyTicked.length) return;
  draft.familyTicked[index] = !draft.familyTicked[index];
  render();
}

export function continueResearchFamily(render) {
  const draft = research();
  if (!pendingFamilyChoice) return;
  const chosen = (draft.familyGroups ?? []).filter((_, index) => draft.familyTicked?.[index]);
  const resolve = pendingFamilyChoice;
  pendingFamilyChoice = null;
  draft.runStatus = "running";
  render();
  resolve(chosen.map(({ form, forms, kind }) => ({ form, forms, kind })));
}

/** The finished run's translations, for the related words researched after it. */
function queueSiblings(queue, store) {
  const frozen = store.load("frozen");
  const aggregate = store.load("aggregate");
  for (const entry of frozen?.entries ?? []) {
    const counts = aggregate?.entries?.[entry.id]?.variants ?? {};
    const chosen = entry.variants.filter((variant) => (counts[variant.id]?.occurrences ?? 0) > 0);
    const variants = chosen.length ? chosen : entry.variants;
    queue.siblings.push({
      sourceTerms: entry.sourceTerms,
      targetTerms: variants.map((variant) => variant.target),
      notes: variants.map((variant) => variant.note ?? ""),
    });
  }
}

async function researchNextFamilyWord(render) {
  const draft = research();
  const queue = draft.familyQueue;
  const next = queue?.words.shift();
  if (!next) {
    draft.familyQueue = null;
    render();
    return;
  }
  Object.assign(draft, {
    term: next.form,
    variants: next.forms.filter((form) => fold(form).trim() !== fold(next.form).trim()),
    existingMatches: findExistingResearchEntries(next.forms),
    proposalDraft: null, reviewError: "", runError: "", stopKind: "",
  });
  await beginResearchRun(render, null, {
    familyBatch: true, familyHeadword: queue.headword,
    siblingEntries: structuredClone(queue.siblings), familyForms: queue.familyForms,
  });
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
  const wasCounting = meta.status === "counting" || Boolean(stages.frozen && !stages.aggregate);
  await beginResearchRun(render, { runId, stages });
  if (stages.confirmedProposal && research()?.runStatus === "review") {
    research().proposalDraft = structuredClone(stages.confirmedProposal);
    // A run stopped during counting continues counting after a resume.
    if (wasCounting) await countGlossaryResearch(render);
  }
}

/** Raise the spending limit from the stop banner and continue the run. */
export async function raiseResearchLimitAndContinue(render) {
  const draft = research();
  const current = Number(draft.spendingLimitUsd) || 0;
  const next = Math.round((Number(draft.raiseLimitTo) || 0) * 100) / 100;
  if (!(next > current)) {
    draft.raiseLimitError = `Enter a limit above ${formatUsd(current)}.`;
    render();
    return;
  }
  draft.raiseLimitError = "";
  draft.spendingLimitUsd = next;
  await resumeGlossaryResearchRun(render, draft.runId);
}

export function resetGlossaryResearchReport() {
  state.glossaryResearchReport = createGlossaryResearchReportState();
}

export function activeResearchRun() {
  return activeRun;
}
