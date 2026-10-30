import { budgetComparison, referenceForTranslationTests, testOmittedInterpretation } from "./glossary-research-studio-experiments.js";
import { createStudioStepTiming, recordStudioSaveTiming } from "./glossary-research-studio-timing.js";
import { state, resetGlossaryTermEditor } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import { invoke } from "./runtime.js";
import { selectedTeam } from "./glossary-shared.js";
import { canWriteGlossaries } from "./permissions.js";
import { resolveAiActionProviderAndModel } from "./ai-settings-flow.js";
import { openGlossaryEditor, loadSelectedGlossaryEditorData } from "./glossary-editor-flow.js";
import { openGlossaryTermEditor, openStudioEntryEditor } from "./glossary-term-draft.js";
import { setStudioEditorHandler } from "./glossary-research-studio-editor-bridge.js";
import { loadStudioHistory, loadStudioStudy, saveStudioStudy, deleteStudioStudy, studioGlossaryEntries, refreshStudioGlossary, exportStudioStudy } from "./glossary-research-studio-query.js";
import { hydrateStudioStep, resolveStudioEvidence } from "./glossary-research-studio-evidence.js";
import { createStudioTools } from "./glossary-research-studio-tools.js";
import { studioStepNeedsReview } from "./glossary-research-studio-review.js";
import { currentStudioRecommendation, recommendStudioStep, sourceSummaryMustBeSkipped, studioCanRecommendSkip, studioResearchStarted } from "./glossary-research-studio-recommendations.js";
import { answerStudioAutoChoice, startStudioAutoChoice } from "./glossary-research-studio-auto-choice.js";
import { prepareReadingTranslations, runResearchStage } from "./glossary-research-studio-stages.js";
import { testMeanings, testCompleteEntry } from "./glossary-research-studio-testing.js";
import { reviewCompoundReport, STUDIO_STEPS, STUDIO_DICTIONARY_REVIEW_VERSION, STUDIO_DEFAULT_BRANCH, newStudioStudy, uniqueTexts, selectedForms, activeMeanings,
  approveStep, stableSignature, stepSignature, stepSignatureMatches, stepIsReusable, buildStudioDraft, finalUsage, studioDependentSteps, clearStudioDependents, startStudioReResearch,
  collisionChanges, sourceCollisions, temporaryGlossaryTerms, uniqueSourceTexts, deduplicateSourceForms, applySplitReview, preferCandidate, reviseAssignment, studioContextRequest, applyStudioContext, entryTrialsAreCurrent, meaningTrialsAreCurrent, studioStepNumber,
  meaningNumber, reviewStudioFinding, applyStudioEntryEdit, studioSingleWordCandidates, studioGlossaryContext } from "./glossary-research-studio-workflow.js";
import { requestGlossaryTermWriteIntent, glossaryTermWriteScope, clearFailedGlossaryTermWrite } from "./glossary-term-write-coordinator.js";
import { requireBrokerSession } from "./auth-flow.js";
import { glossaryRepoDescriptor, syncSingleGlossaryForTeam, getGlossarySyncIssueMessage } from "./glossary-repo-flow.js";
import { getGlossaryWritePolicy } from "./resource-write-policy.js";
import { removeGlossaryEditorQuery } from "./glossary-editor-query.js";
import { refreshEditorGlossaryAfterLocalChange } from "./editor-glossary-flow.js";
import { syncAndStopGlossaryBackgroundSyncSession } from "./glossary-background-sync.js";

let currentTools = null;
let currentTiming = null;
let sourceContextTools = null;
let readingTools = null;
let operationGeneration = 0;
let renderStudio = () => {};
let editSaveTimer;

function requestStudioRedo(operation, step = studioView().study?.step) {
  const view = studioView(); const s = view.study;
  if (!s || !studioDependentSteps(s, step).length) return false;
  if (view.modal?.kind === "redo") return true;
  const previousModal = view.modal;
  view.modal = { kind: "redo", study: s, step, previousModal, operation };
  renderStudio();
  return true;
}

function markStudioEdited(s) {
  if (s.steps[s.step]) s.steps[s.step].status = "awaiting-review";
  if (["complete", "merged", "no-new-entry"].includes(s.status)) s.status = "active";
  studioView().revisiting = false;
  delete s.reviewNavigation;
}

export function studioCanVisitStep(s, step) {
  const target = STUDIO_STEPS.findIndex((item) => item.id === step);
  const current = STUDIO_STEPS.findIndex((item) => item.id === s.step);
  return target >= 0 && (target <= current || Boolean(s.steps[step] && s.steps[step].status !== "undone")
    || target <= (studioView().reviewFrontier ?? -1));
}

async function visitStudioStep(step) {
  const view = studioView(); const s = view.study;
  if (!s || !studioCanVisitStep(s, step) || view.saving || view.modal?.kind === "redo") return;
  if (s.step === step) return;
  const generation = ++operationGeneration;
  currentTiming?.finish("paused"); await currentTools?.cancel();
  await readingTools?.cancel(); readingTools = null; view.readingBusy = null;
  await sourceContextTools?.cancel(); sourceContextTools = null;
  if (!contextMatches(s) || generation !== operationGeneration) return;
  view.reviewFrontier = Math.max(view.reviewFrontier ?? -1, STUDIO_STEPS.findIndex((item) => item.id === s.step));
  if (s.pendingDecision && !view.decisionStep) view.decisionStep = s.step;
  await hydrateStudioStep(s, step);
  if (!contextMatches(s) || generation !== operationGeneration) return;
  s.step = step; view.revisiting = true; view.modal = null;
  s.reviewNavigation = { frontier: view.reviewFrontier, decisionStep: view.decisionStep };
  view.hideDecision = Boolean(s.pendingDecision && view.decisionStep !== step);
  view.busy = false; view.message = ""; view.error = ""; renderStudio();
  if (step === "2a" && !s.pendingDecision) await recommendCurrentStep();
}
export function studioView() {
  return state.glossaryResearchStudio ??= { study: null, history: [], busy: false,
    message: "", error: "", modal: null, branch: STUDIO_DEFAULT_BRANCH, mergeDestinations: {} };
}
function currentScope() {
  const team = selectedTeam(); const editor = state.glossaryEditor;
  return { installationId: team?.installationId, teamId: team?.id, glossaryId: editor.glossaryId,
    repoName: editor.repoName, sourceLanguage: editor.sourceLanguage, targetLanguage: editor.targetLanguage };
}
async function translatorRuntimeVersion() {
  const version = await invoke("plugin:app|version");
  if (typeof version !== "string" || !version.trim()) throw new Error("The app's translator version could not be determined. Reopen research before continuing.");
  return version.trim();
}
function contextMatches(s) { return state.selectedTeamId === s.scope.teamId
  && state.glossaryEditor.glossaryId === s.scope.glossaryId && studioView().study === s; }
async function persist(s = studioView().study) {
  if (!s) return;
  const step = s.step; const started = performance.now(); let failed = true;
  try {
    const saved = await saveStudioStudy(s); s.revision = saved.revision; s.updatedAt = saved.updatedAt; failed = false;
  } finally { recordStudioSaveTiming(s, step, performance.now() - started, failed); }
}
function toolsFor(s, timing) {
  const generation = operationGeneration;
  const isCurrent = () => contextMatches(s) && state.screen === "glossaryResearchStudio" && generation === operationGeneration;
  return createStudioTools(s, { persist: () => persist(s),
    isCurrent, timing, activityChanged: () => { if (isCurrent()) renderStudio(); },
    progress: (message) => { if (isCurrent()) { studioView().message = message; renderStudio(); } } });
}
async function guarded(operation, owner = null, manageBusy = true) {
  const view = studioView(); view.error = "";
  const generation = operationGeneration;
  const ownsOperation = () => (!owner || view.study === owner) && generation === operationGeneration;
  try { await operation(); } catch (error) {
    if ((owner && view.study !== owner) || (manageBusy && !ownsOperation())) return;
    view.error = error?.message === "Research paused." ? "" : (error?.message ?? String(error));
    if (view.study) { view.study.error = view.error; await persist().catch(() => {}); }
  } finally {
    if (manageBusy && ownsOperation()) { view.busy = false; view.message = ""; }
    if (!manageBusy || ownsOperation()) renderStudio();
  }
}

async function loadSourceContext() {
  const view = studioView(); const s = view.study; const modal = view.modal;
  if (modal?.kind !== "meaningReview" || view.busy || view.savingAssignment || modal.loadingContext) return;
  const paragraph = s.passages.find((p) => p.id === modal.paragraphId);
  const request = studioContextRequest(paragraph);
  if (!request) throw new Error("Wider context is not available from this source reference.");
  const isCurrent = () => contextMatches(s) && state.screen === "glossaryResearchStudio" && view.modal === modal;
  // Share receipts, but keep this read's retry pointer separate from the paused
  // research operation so it cannot redirect Retry this step to a context lookup.
  const timing = createStudioStepTiming(s, s.step);
  const lookup = { ...s };
  const tools = createStudioTools(lookup, { timing, persist: () => persist(s), isCurrent, progress: () => {} });
  sourceContextTools = tools; modal.loadingContext = true; modal.contextError = ""; renderStudio();
  try {
    const result = await tools.run("corpus", request, "Loading wider source context");
    if (!isCurrent()) return;
    applyStudioContext(s, modal.paragraphId, result);
    timing.finish("complete");
    await persist(s);
  } catch (error) {
    timing.finish(error?.message === "Research paused." ? "paused" : "failed");
    if (isCurrent() && error?.message !== "Research paused.") {
      modal.contextError = error?.message ?? String(error);
      if (lookup.lastToolSignature) {
        s.toolRetries ??= {};
        s.toolRetries[lookup.lastToolSignature] = (s.toolRetries[lookup.lastToolSignature] ?? 0) + 1;
        await persist(s);
      }
    }
  } finally {
    timing.finish("paused");
    if (sourceContextTools === tools) sourceContextTools = null;
    modal.loadingContext = false;
    if (isCurrent()) renderStudio();
  }
}

async function readingTranslation(id) {
  const view = studioView(); const s = view.study;
  if (!s || view.busy || view.readingBusy || s.step !== "4.6" || !s.passages.some((p) => p.id === id)) return;
  const timing = createStudioStepTiming(s, "reading-aids");
  s.displayTranslations ??= {}; s.toolRetries ??= {};
  const lookup = { ...s }; const generation = operationGeneration; const request = {};
  view.readingOperation = request;
  const isCurrent = () => contextMatches(s) && state.screen === "glossaryResearchStudio" && s.step === "4.6" && generation === operationGeneration && view.readingOperation === request;
  view.readingBusy = id; view.readingErrors ??= {}; delete view.readingErrors[id]; renderStudio();
  const tools = createStudioTools(lookup, { timing, persist: () => persist(s), isCurrent, progress: () => {} }); readingTools = tools;
  try { await prepareReadingTranslations(lookup, tools, [id]); timing.finish("complete"); await persist(s); }
  catch (error) {
    timing.finish(error?.message === "Research paused." ? "paused" : "failed");
    if (isCurrent() && error?.message !== "Research paused.") {
      view.readingErrors[id] = error.message ?? String(error);
      if (lookup.lastToolSignature) s.toolRetries[lookup.lastToolSignature] = (s.toolRetries[lookup.lastToolSignature] ?? 0) + 1;
      await persist(s);
    }
  }
  finally { if (readingTools === tools) readingTools = null; if (view.readingOperation === request) { view.readingBusy = null; view.readingOperation = null; } renderStudio(); }
}

async function viewSourceParagraph(id) {
  const view = studioView(); const s = view.study;
  if (!s) return;
  const modal = { kind: "sourceParagraph", paragraphId: id, loading: true };
  view.modal = modal; renderStudio();
  try {
    const passages = await resolveStudioEvidence(s, s.passages);
    if (!contextMatches(s) || view.modal !== modal) return;
    modal.paragraph = passages.find((p) => p.id === id);
    if (!modal.paragraph) modal.error = "This paragraph is not in the selected research sample. Review its original source report.";
  } catch (error) {
    if (view.modal === modal) modal.error = error?.message ?? String(error);
  } finally { if (view.modal === modal) { modal.loading = false; renderStudio(); } }
}

export async function openStudio(render) {
  await readingTools?.cancel(); readingTools = null; studioView().readingBusy = null;
  renderStudio = render;
  if (!canWriteGlossaries(selectedTeam())) return;
  operationGeneration += 1; currentTiming?.finish("paused"); await currentTools?.cancel();
  const view = studioView(); view.study = null; view.openingStudyId = null; view.error = ""; state.screen = "glossaryResearchStudio";
  view.reviewFrontier = null; view.revisiting = false; view.decisionStep = null;
  view.busy = false; view.message = "";
  startAutoChoice();
  render();
  await guarded(async () => { view.history = await loadStudioHistory(currentScope()); });
}

/** Research from the chapter editor: a new study with the term filled in. */
export async function openStudioForTerm(render, term, { projectId = null } = {}) {
  await openStudio(render);
  if (state.screen !== "glossaryResearchStudio" || studioView().study) return;
  await guarded(() => newStudy({ term, projectId }));
}

export async function newStudy({ term = "", projectId = null } = {}) {
  await readingTools?.cancel(); readingTools = null; studioView().readingBusy = null;
  const generation = ++operationGeneration;
  studioView().openingStudyId = null;
  const scope = currentScope();
  const corpus = scope.sourceLanguage.code.startsWith("es") ? "samael" : "projects";
  // Project texts: start from the chapter's own project when there is one.
  const projectIds = corpus === "projects" && projectId
    && state.projects.some((project) => project.id === projectId && project.lifecycleState !== "deleted") ? [projectId] : [];
  const s = newStudioStudy({ ...scope, corpus, term: String(term ?? "").trim(), projectIds });
  s.model = resolveAiActionProviderAndModel("research");
  s.translationRuntimeVersion = await translatorRuntimeVersion();
  if (generation !== operationGeneration) return;
  studioView().openingStudyId = null; studioView().study = s; studioView().branch = STUDIO_DEFAULT_BRANCH;
  studioView().reviewFrontier = null; studioView().revisiting = false; studioView().decisionStep = null;
  studioView().mergeDestinations = {}; studioView().hideDecision = false; studioView().modal = null;
  await persist(s); renderStudio();
}

export async function resumeStudy(id) {
  await readingTools?.cancel(); readingTools = null; studioView().readingBusy = null;
  const scope = currentScope();
  const view = studioView(); if (view.openingStudyId === id) return;
  const generation = ++operationGeneration;
  const previous = view.study; let accepted = false; view.openingStudyId = id; renderStudio();
  try {
    const [study, runtimeVersion] = await Promise.all([loadStudioStudy(scope, id), translatorRuntimeVersion(), refreshStudioGlossary(scope)]);
    if (generation !== operationGeneration || view.openingStudyId !== id || view.study !== previous || state.screen !== "glossaryResearchStudio"
      || state.selectedTeamId !== scope.teamId || state.glossaryEditor.glossaryId !== scope.glossaryId) return;
    accepted = true;
    if (study.schemaVersion !== 1 || study.scope.teamId !== scope.teamId) throw new Error("This study belongs to another team or an unsupported data version.");
    if (study.translationRuntimeVersion !== runtimeVersion && study.steps["9"]) study.steps["9"].status = "stale";
    study.translationRuntimeVersion = runtimeVersion;
    view.study = study; study.error = "";
    view.reviewFrontier = study.reviewNavigation?.frontier ?? null;
    view.revisiting = Boolean(study.reviewNavigation); view.decisionStep = study.reviewNavigation?.decisionStep ?? null;
    study.forms = deduplicateSourceForms(study.forms, study.scope.sourceLanguage.code);
    if (study.step === "4.7" && !study.splitProposals) study.splitProposals = study.queue.map((q) => ({
      id: q.id, forms: uniqueSourceTexts(q.forms, study.scope.sourceLanguage.code),
      meaningId: q.meaningId, targetTerms: q.targetTerms, selected: true }));
    view.branch = study.branch ?? study.steps["2b"]?.approved?.branch ?? STUDIO_DEFAULT_BRANCH;
    view.mergeDestinations = study.mergeDestinations ?? {};
    view.hideDecision = Boolean(study.pendingDecision && view.decisionStep && view.decisionStep !== study.step);
    view.modal = null; view.openingStudyId = null; renderStudio();
    if (await advanceIfNoReview(study, study.step, generation)) return;
    if (studioCanRecommendSkip(study.step) && !["complete", "merged", "cancelled"].includes(study.status)
      && (!view.revisiting || study.step === "2a") && !await stepIsReusable(study, study.step)) await recommendCurrentStep();
  } catch (error) {
    if (accepted || (view.openingStudyId === id && view.study === previous)) throw error;
  } finally {
    if (view.openingStudyId === id) { view.openingStudyId = null; renderStudio(); }
  }
}

async function deleteSavedStudy() {
  const view = studioView(); const modal = view.modal;
  if (view.study || modal?.kind !== "delete" || view.deletingStudyId) return;
  const scope = currentScope();
  if (scope.teamId !== modal.scope.teamId || scope.glossaryId !== modal.scope.glossaryId
    || scope.installationId !== modal.scope.installationId) throw new Error("Reopen research history before deleting this study.");
  view.deletingStudyId = modal.study.id; renderStudio();
  globalThis.clearTimeout(editSaveTimer);
  try {
    await deleteStudioStudy(scope, modal.study.id);
    const history = await loadStudioHistory(scope);
    if (!view.study && currentScope().teamId === scope.teamId && currentScope().glossaryId === scope.glossaryId) {
      view.history = history; view.modal = null;
    }
  } finally { view.deletingStudyId = null; renderStudio(); }
}

function hydrateResult(s, step, result) {
  if (step === "2a" && result.forms) s.forms = deduplicateSourceForms(structuredClone(result.forms), s.scope.sourceLanguage.code);
  if (step === "4.5" && result.meanings && !s.meanings.length) s.meanings = structuredClone(result.meanings);
  if (step === "6" && result.candidates && !s.candidates.length) s.candidates = structuredClone(result.candidates);
}

const comparisonStateFields = ["candidates", "generalNote", "footnote", "tests", "rounds", "reports", "retryAllowances", "entryValidation", "assignmentReviewPending", "retentionReviewed", "draft"];
const comparisonState = (s) => structuredClone(Object.fromEntries(comparisonStateFields.map((key) => [key, s[key] ?? null])));

export async function runCurrentStage(fresh = false) {
  const view = studioView(); const s = view.study;
  if (!s || view.busy) return;
  view.revisiting = false; delete s.reviewNavigation;
  const generation = ++operationGeneration; const step = s.step;
  await guarded(async () => {
    if (!canWriteGlossaries(selectedTeam())) throw new Error("You no longer have permission to research this glossary.");
    // Claim the operation before asynchronous fingerprinting so repeated clicks
    // cannot launch the same research request twice.
    view.busy = true; renderStudio();
    if (fresh) {
      if (["1", "10a", "10b", "11", "12"].includes(step) || !s.steps[step]?.value) throw new Error("This step is not ready for a research comparison.");
      let replay;
      if (["8", "9"].includes(step)) {
        if (!s.steps[step].value.complete || !s.comparisonStarts?.[step]) throw new Error("Finish this step before comparing recorded test inputs.");
        if (s.comparisonStartSignatures?.[step] !== await stepSignature(s, step)) throw new Error("Approved inputs changed. Run this step with the revised inputs before comparing it.");
        replay = await resolveStudioEvidence(s, s.comparisonStarts[step]);
      }
      s.comparisonHistory ??= {};
      (s.comparisonHistory[step] ??= []).push({ savedAt: new Date().toISOString(), record: structuredClone(s.steps[step]), activity: structuredClone(s.activitySteps?.[step] ?? null) });
      if (step === "4.6") {
        const archive = s.comparisonHistory[step].at(-1);
        archive.workflowState = structuredClone(Object.fromEntries(["passages", "assignments", "meanings", "displayTranslations", "recoveryScanned", "recoveryConsidered", "recoveryUnconfirmed", "excludedParagraphIds"].map((key) => [key, s[key]])));
        s.passages = s.passages.filter((p) => !p.recovered);
        s.assignments = []; s.displayTranslations = {}; s.recoveryScanned = []; s.recoveryConsidered = 0; s.recoveryUnconfirmed = [];
        for (const m of s.meanings) m.unused = false;
      }
      if (step === "4.7") {
        s.comparisonHistory[step].at(-1).workflowState = structuredClone({ splitProposals: s.splitProposals, assignments: s.assignments, meanings: s.meanings });
        Object.assign(s, applySplitReview(s, [])); s.splitProposals = [];
      }
      if (replay) {
        s.comparisonHistory[step].at(-1).workflowState = comparisonState(s);
        for (const [key, value] of Object.entries(replay.fields)) s[key] = structuredClone(value);
        const reset = (key) => key.startsWith(`${step}:`) || (step === "8" && key.startsWith("9:"));
        s.tests = Object.fromEntries(Object.entries(s.tests ?? {}).filter(([key]) => !reset(key)));
        s.rounds = Object.fromEntries(Object.entries(s.rounds ?? {}).filter(([key]) => !reset(key)));
        s.retryAllowances = Object.fromEntries(Object.entries(s.retryAllowances ?? {}).filter(([key]) => !reset(key)));
        s.reports = {}; s.entryValidation = null; s.retentionReviewed = false; delete s.usage; delete s.usageByText;
      }
      if (s.activitySteps) delete s.activitySteps[step];
      s.comparisonAttempt = { step, id: crypto.randomUUID() };
      s.pendingDecision = null;
      s.steps[step] = { ...s.steps[step], status: "running", generatedSignature: null, value: null };
      await persist(s);
    }
    const timing = createStudioStepTiming(s, step);
    currentTiming = timing;
    try {
      if (s.step === "2b") {
        view.busy = true; view.message = "Loading existing glossary entries"; renderStudio();
        await refreshStudioGlossary(s.scope);
        if (!contextMatches(s) || generation !== operationGeneration) return;
      }
      if (s.error) {
        if (s.lastToolSignature) {
          s.toolRetries ??= {};
          s.toolRetries[s.lastToolSignature] = (s.toolRetries[s.lastToolSignature] ?? 0) + 1;
        }
        if (s.steps[s.step]) s.steps[s.step].generatedSignature = null;
        s.error = "";
      } else if (!fresh && await stepIsReusable(s, s.step) && (s.step !== "9" || entryTrialsAreCurrent(s))
        && (s.step !== "8" || meaningTrialsAreCurrent(s))) { timing.finish("reused"); return; }
      const signature = await stepSignature(s, step);
      const record = s.steps[step];
      const matches = await stepSignatureMatches(s, step, record?.generatedSignature);
      if (!contextMatches(s) || generation !== operationGeneration || s.step !== step) return;
      if (!fresh && matches && record.value && !s.pendingDecision
        && !["4.6", "8", "9"].includes(step)) { hydrateResult(s, step, record.value); timing.finish("reused"); return; }
      if (["8", "9"].includes(step) && s.comparisonStartSignatures?.[step] !== signature) {
        if (s.comparisonStarts?.[step]) {
          s.comparisonHistory ??= {};
          (s.comparisonHistory[step] ??= []).push({ savedAt: new Date().toISOString(), startingInputs: s.comparisonStarts[step], reason: "Approved inputs changed" });
        }
        s.comparisonStarts ??= {}; s.comparisonStartSignatures ??= {};
        s.comparisonStarts[step] = { fields: comparisonState(s) }; s.comparisonStartSignatures[step] = signature;
        await persist(s);
        if (!contextMatches(s) || generation !== operationGeneration || s.step !== step) return;
      }
      view.busy = true; renderStudio();
      currentTools = toolsFor(s, timing);
      if (["8", "9"].includes(s.step)) s.glossaryContext = studioGlossaryContext(s, studioGlossaryEntries(s.scope));
      const result = s.step === "8" ? await testMeanings(s, currentTools)
        : s.step === "9" ? await testCompleteEntry(s, currentTools)
          : await runResearchStage(s, currentTools, studioGlossaryEntries(s.scope));
      if (!contextMatches(s) || generation !== operationGeneration || s.step !== step) return;
      if (s.step === "8" && !result.pending) s.assignmentReviewPending = false;
      s.steps[s.step] = { ...s.steps[s.step], status: result.pending ? "awaiting-review" : "awaiting-review",
        generatedSignature: signature, value: structuredClone(result) };
      timing.finish(result.pending ? "awaiting-review" : "complete");
      s.error = ""; await persist(s);
    } catch (error) {
      timing.finish(error?.message === "Research paused." || generation !== operationGeneration ? "paused" : "failed");
      throw error;
    } finally { timing.finish("paused"); }
  }, s);
  await advanceIfNoReview(s, step, generation);
}

async function recommendCurrentStep(refresh = false) {
  const view = studioView(); const s = view.study;
  if (!s || view.busy || !studioCanRecommendSkip(s.step) || ["complete", "merged", "cancelled"].includes(s.status)) return;
  if (studioResearchStarted(s)) return;
  if (!canWriteGlossaries(selectedTeam())) throw new Error("You no longer have permission to research this glossary.");
  if (!refresh && currentStudioRecommendation(s)) return;
  const step = s.step; const generation = operationGeneration; const request = {};
  const isCurrent = () => contextMatches(s) && state.screen === "glossaryResearchStudio"
    && s.step === step && generation === operationGeneration;
  view.busy = true; view.recommendationRequest = request; view.recommendingStep = step;
  view.message = `Considering whether step ${studioStepNumber(step)} would help`; renderStudio();
  globalThis.document?.querySelector(".studio-recommendation")?.scrollIntoView({ block: "nearest" });
  const timing = createStudioStepTiming(s, `recommendation:${step}`);
  s.toolRetries ??= {};
  // Share durable receipts, but keep recommendation retries and activities from
  // replacing the research stage's retry pointer or progress tree.
  const lookup = { ...s, step: `recommendation:${step}`, activitySteps: {} };
  const tools = createStudioTools(lookup, { timing, persist: () => persist(s), isCurrent, progress: () => {} });
  const previousTools = currentTools; const previousTiming = currentTiming;
  currentTools = tools; currentTiming = timing;
  try {
    const recommendation = await recommendStudioStep(s, tools, { refresh });
    if (!isCurrent()) return;
    s.skipRecommendations ??= {};
    if (s.skipRecommendations[step]) {
      s.skipRecommendationHistory ??= [];
      s.skipRecommendationHistory.push({ step, ...s.skipRecommendations[step] });
    }
    s.skipRecommendations[step] = recommendation;
    timing.finish(recommendation.fallback ? "failed" : "complete");
    await persist(s);
  } catch (error) {
    timing.finish(error?.message === "Research paused." ? "paused" : "failed");
    if (isCurrent() && error?.message !== "Research paused.") throw error;
  } finally {
    timing.finish("paused");
    if (currentTools === tools) currentTools = previousTools;
    if (currentTiming === timing) currentTiming = previousTiming;
    if (view.recommendationRequest === request) { view.recommendationRequest = null; view.recommendingStep = null; }
    if (isCurrent()) { view.busy = false; view.message = ""; }
    renderStudio();
  }
}

// Choosing Run or Skip answers the question the pending recommendation asks, so
// the request is cancelled and its late answer discarded.
async function abandonRecommendation() {
  const view = studioView();
  if (!view.recommendationRequest) return;
  view.recommendationRequest = null; view.recommendingStep = null;
  operationGeneration += 1;
  currentTiming?.finish("paused"); await currentTools?.cancel();
  view.busy = false; view.message = "";
}

const STUDIO_SINGLE_WORD_SKIP = "There is one meaning and one candidate translation, so there is nothing to choose between. Step 9 tests that translation in the complete entry.";

async function moveTo(s, step) {
  const generation = operationGeneration;
  const isCurrent = () => contextMatches(s) && generation === operationGeneration && state.screen === "glossaryResearchStudio";
  if (!isCurrent()) return;
  studioView().revisiting = false; studioView().reviewFrontier = null; studioView().decisionStep = null;
  delete s.reviewNavigation;
  await readingTools?.cancel(); readingTools = null; studioView().readingBusy = null;
  if (!isCurrent()) return;
  if (step === "10b") await refreshStudioGlossary(s.scope);
  if (!isCurrent()) return;
  s.step = step; s.pendingDecision = null;
  await hydrateStudioStep(s, step);
  if (!isCurrent()) return;
  if (await stepIsReusable(s, step)) hydrateResult(s, step, s.steps[step].approved);
  else if (await stepSignatureMatches(s, step, s.steps[step]?.generatedSignature)) {
    hydrateResult(s, step, s.steps[step].value);
  }
  if (!isCurrent()) return;
  if (step === "10a") {
    const counts = finalUsage(s);
    const textCounts = finalUsage(s, { groupByText: true });
    if (!s.retentionReviewed) {
      for (const c of s.candidates) c.retained = (textCounts[c.text]?.occurrences ?? 0) > 0;
      s.retentionReviewed = true;
    }
    s.usage = counts; s.usageByText = textCounts;
  }
  await persist(s);
  if (!isCurrent()) return;
  renderStudio();
  if (step === "4.4.1" && s.scope.corpus !== "samael") {
    const value = { skipped: true, reason: "Available for Samael Aun Weor only" };
    s.steps[step] = { value }; await approveStep(s, step, value); await persist(s);
    if (isCurrent()) await moveTo(s, "4.4.2");
  } else if (step === "8" && studioSingleWordCandidates(s)) {
    for (const candidate of studioSingleWordCandidates(s)) candidate.confirmed = true;
    s.assignmentReviewPending = false;
    const value = { skipped: true, reason: STUDIO_SINGLE_WORD_SKIP };
    s.steps[step] = { ...s.steps[step], value };
    await approveStep(s, step, value); await persist(s);
    if (isCurrent()) await moveTo(s, "9");
  } else if (step === "4.4.4" && sourceSummaryMustBeSkipped(s)) {
    const value = { skipped: true, reason: "Both source branches were skipped" };
    s.steps[step] = { ...s.steps[step], value };
    await approveStep(s, step, value); await persist(s);
    if (isCurrent()) await moveTo(s, "4.5");
  } else if (studioCanRecommendSkip(step)) {
    if (!await advanceIfNoReview(s, step, operationGeneration) && !await stepIsReusable(s, step)) await recommendCurrentStep();
  } else if (step === "10b") {
    await advanceIfNoReview(s, step, operationGeneration);
  } else if (!["1", "10a", "10b", "11", "12"].includes(step)) await runCurrentStage();
}

async function mergeOnly(s) {
  const view = studioView();
  await refreshStudioGlossary(s.scope);
  const entries = studioGlossaryEntries(s.scope);
  const forms = selectedForms(s);
  if (forms.some((form) => !view.mergeDestinations[form])) throw new Error("Choose an existing entry for each source variant.");
  const team = { ...selectedTeam() };
  const glossary = { ...state.glossaries.find((g) => g.id === s.scope.glossaryId), ...state.glossaryEditor };
  const policy = getGlossaryWritePolicy({ team, glossary }); if (!policy.allowed) throw new Error(policy.message);
  for (const id of uniqueTexts(Object.values(view.mergeDestinations))) {
    const old = entries.find((e) => e.termId === id); if (!old) throw new Error("A destination entry is no longer available.");
    const sourceTerms = uniqueTexts([...old.sourceTerms, ...forms.filter((form) => view.mergeDestinations[form] === id)]);
    if (stableSignature(old.sourceTerms) === stableSignature(sourceTerms)) continue;
    await new Promise((resolve, reject) => requestGlossaryTermWriteIntent({
      key: `studio-merge:${s.id}:${id}`, scope: glossaryTermWriteScope(team, s.scope.repoName), teamId: team.id,
      type: "glossaryStudioMerge", value: { termId: id },
    }, { clearOnSuccess: true, run: async () => {
      await invoke("sync_gtms_glossary_editor_repo", { input: { installationId: team.installationId,
        ...glossaryRepoDescriptor(glossary) }, sessionToken: requireBrokerSession() });
      const latest = await invoke("load_gtms_glossary_term", { input: { installationId: team.installationId,
        glossaryId: s.scope.glossaryId, repoName: s.scope.repoName, termId: id } });
      if (stableSignature(latest.term?.sourceTerms) !== stableSignature(old.sourceTerms)) throw new Error("An existing entry changed. Reopen the merge choices.");
      // Preserve the latest target wording and notes if another researcher edited them.
      const saved = await invoke("upsert_gtms_glossary_term", { input: { ...latest.term, ...s.scope, termId: id, sourceTerms } });
      try {
        const issue = getGlossarySyncIssueMessage(await syncSingleGlossaryForTeam(team, glossary));
        if (issue?.message) throw new Error(issue.message);
      } catch (error) {
        await invoke("rollback_gtms_glossary_term_upsert", { input: { ...s.scope, previousHeadSha: saved.previousHeadSha } }); throw error;
      }
      s.mergeSaved ??= []; s.mergeSaved.push(id); await persist(s);
    }, onSuccess: resolve, onError: reject }));
  }
  s.status = "merged"; await persist(s);
  removeGlossaryEditorQuery(team, glossary);
  await refreshStudioGlossary(s.scope);
  await refreshEditorGlossaryAfterLocalChange(renderStudio, team, s.scope);
}

export async function advanceStudio() {
  const view = studioView(); const s = view.study;
  if (!s || view.busy || view.saving) return;
  // Browsing a saved checkpoint must not rebuild its approval from mutable
  // fields that may have been refined in later stages (e.g. candidate notes).
  if (view.revisiting && (s.steps[s.step]?.approved || ["complete", "skipped"].includes(s.steps[s.step]?.status))) {
    const next = STUDIO_STEPS[STUDIO_STEPS.findIndex((item) => item.id === s.step) + 1];
    if (next && studioCanVisitStep(s, next.id)) { await visitStudioStep(next.id); return; }
  }
  const generation = ++operationGeneration;
  view.saving = true; renderStudio();
  await guarded(() => advanceStudioCheckpoint(s, generation), s).finally(() => { view.saving = false; renderStudio(); });
}

async function advanceStudioCheckpoint(s, generation) {
  if (!contextMatches(s) || generation !== operationGeneration) return;
  if (s.pendingDecision) throw new Error("Resolve the current research question before continuing.");
  const step = s.step;
  let value = s.steps[step]?.value ?? s.steps[step]?.approved;
  if (step === "1") {
    if (!s.scope.term.trim()) throw new Error("Enter a term to research.");
    if (s.scope.corpus === "projects" && !s.scope.projectIds.length) throw new Error("Select at least one project.");
    if (!s.model.modelId) throw new Error("Select a Research model in AI Settings first.");
    s.scope.forms = uniqueSourceTexts([s.scope.term, ...s.scope.forms], s.scope.sourceLanguage.code);
    s.forms = s.scope.forms.map((text) => ({ text, selected: true })); value = s.scope;
  } else if (step === "2a") {
    if (!s.steps[step]?.value || s.formDiscovery?.version !== 3 || s.formDiscovery.phase !== "complete") throw new Error("Finish the forms search, or skip this optional step.");
    s.forms = deduplicateSourceForms(s.forms, s.scope.sourceLanguage.code);
    if (!selectedForms(s).length) throw new Error("Select at least one source form.");
    value = { forms: s.forms };
  } else if (step === "2b" && s.relatedEntries.length) {
    if (studioView().branch === "merge") { await mergeOnly(s); return; }
    if (studioView().branch === "research" && startStudioReResearch(s)) { await moveTo(s, "2a"); return; }
    value = { branch: studioView().branch, entries: s.relatedEntries };
  } else if (step === "4.1" && value?.dictionaryVersion !== STUDIO_DICTIONARY_REVIEW_VERSION) {
    throw new Error("Refresh dictionary research before continuing so capitalization variants are checked.");
  } else if (step === "5") {
    value = reviewCompoundReport(s, value);
  } else if (step === "4.7") {
    if (!value || value.pending) throw new Error("Run the split-entry check before continuing.");
    Object.assign(s, applySplitReview(s, s.splitProposals ?? []));
    value = { splits: s.queue, proposals: s.splitProposals ?? [] };
  } else if (step === "4.5") {
    if (!s.meanings.some((m) => m.enabled !== false)) throw new Error("Keep at least one meaning.");
    value = { meanings: s.meanings.map(({ splitOff: _splitOff, unused: _unused, ...meaning }) => meaning) };
  } else if (step === "6") {
    s.candidates = s.candidates.filter((c) => c.selected !== false && c.meaningIds.length);
    if (activeMeanings(s).some((m) => !s.candidates.some((c) => c.meaningIds.includes(m.id)))) throw new Error("Each active meaning needs a candidate.");
    value = { candidates: s.candidates.map(({ confirmed: _confirmed, retained: _retained, temporary: _temporary, ...candidate }) => candidate) };
  } else if (step === "8" && !meaningTrialsAreCurrent(s)) {
    throw new Error("Retest the edited meaning candidates before continuing.");
  } else if (step === "9" && s.assignmentReviewPending) {
    throw new Error("Retest the revised meaning assignments before continuing.");
  } else if (step === "9" && !entryTrialsAreCurrent(s)) {
    throw new Error("Retest the edited entry before continuing.");
  } else if (step === "10a") {
    if (!s.candidates.some((c) => c.confirmed && c.retained !== false)) throw new Error("Keep at least one target translation.");
    value = { retained: s.candidates.filter((c) => c.retained !== false).map((c) => c.id) };
  } else if (step === "10b") {
    const draft = buildStudioDraft(s);
    await refreshStudioGlossary(s.scope);
    if (!contextMatches(s) || generation !== operationGeneration) return;
    const colliding = sourceCollisions(s, studioGlossaryEntries(s.scope)).map((item) => item.form);
    if (colliding.some((form) => !s.collisions[form])) throw new Error("Choose how to resolve each collision.");
    if (!draft.sourceTerms.length) { s.status = "no-new-entry"; await moveTo(s, "12"); return; }
    // Pruning/retention changes require a final test of the actual retained entry.
    const timing = createStudioStepTiming(s, step); currentTiming = timing;
    currentTools = toolsFor(s, timing); studioView().busy = true;
    s.glossaryContext = studioGlossaryContext(s, studioGlossaryEntries(s.scope));
    let checked;
    try { checked = await testCompleteEntry(s, currentTools); timing.finish(checked.pending ? "awaiting-review" : "complete"); }
    catch (error) { timing.finish(error?.message === "Research paused." ? "paused" : "failed"); throw error; }
    if (!contextMatches(s) || generation !== operationGeneration) return;
    if (checked.pending) { s.step = "9"; await persist(s); return; }
    s.usage = finalUsage(s);
    s.usageByText = finalUsage(s, { groupByText: true });
    value = { collisions: s.collisions };
  } else if (step === "11") { await openDraftEditor(s); return; }
  else if (step === "12") { await startQueuedEntry(s); return; }
  else if (!value || value.pending) throw new Error("Run this step and resolve its questions before continuing.");
  const changed = await approveStep(s, step, value);
  if (!contextMatches(s) || generation !== operationGeneration) return;
  if (changed && STUDIO_STEPS.findIndex((st) => st.id === step) <= STUDIO_STEPS.findIndex((st) => st.id === "4.5")) {
    s.assignments = []; s.queue = []; s.tests = {}; s.rounds = {}; s.retentionReviewed = false;
    s.recoveryScanned = []; s.recoveryConsidered = 0; s.excludedParagraphIds = [];
    for (const meaning of s.meanings) { meaning.splitOff = false; meaning.unused = false; }
  }
  if (step === "4.7" && !activeMeanings(s).length) { await moveTo(s, "12"); return; }
  const next = STUDIO_STEPS[STUDIO_STEPS.findIndex((st) => st.id === step) + 1];
  if (next) await moveTo(s, next.id);
}

async function advanceIfNoReview(s, step, generation) {
  const view = studioView();
  if (view.busy || view.error || view.revisiting || view.modal || state.screen !== "glossaryResearchStudio"
    || s.referenceStudyId
    || !contextMatches(s) || s.step !== step || generation !== operationGeneration
    || ["complete", "merged", "cancelled", "no-new-entry"].includes(s.status)) return false;
  const result = s.steps[step]?.value ?? s.steps[step]?.approved;
  if (studioStepNeedsReview(s, step, result, studioGlossaryEntries(s.scope))) return false;
  const saving = view.saving;
  view.saving = true; renderStudio();
  try { await guarded(() => advanceStudioCheckpoint(s, generation), s); }
  finally { if (view.study === s) view.saving = saving; renderStudio(); }
  return true;
}


async function openDraftEditor(s) {
  s.draft = buildStudioDraft(s); await persist(s);
  state.screen = "glossaryEditor";
  await loadSelectedGlossaryEditorData(renderStudio, { glossaryId: s.scope.glossaryId });
  if (!contextMatches(s) || state.screen !== "glossaryEditor") return;
  if (state.glossaryEditor.status !== "ready") {
    state.screen = "glossaryResearchStudio";
    throw new Error("The glossary could not be loaded for saving. Retry opening the term editor.");
  }
  const changes = collisionChanges(s.draft, studioGlossaryEntries(s.scope).filter((e) => e.termId !== s.savedTermId), s.collisions, s.scope.sourceLanguage.code);
  await openGlossaryTermEditor(renderStudio, s.savedTermId ?? null);
  if (!state.glossaryTermEditor.isOpen) { state.screen = "glossaryResearchStudio"; return; }
  const restoreDraft = s.editorDraftSignature === stableSignature(s.draft) ? s.editorDraft : null;
  const draft = restoreDraft ?? s.draft;
  const editable = Object.fromEntries(["sourceTerms", "targetTerms", "targetVariantNotes",
    "notesToTranslators", "footnote", "untranslated"].filter((key) => key in draft).map((key) => [key, draft[key]]));
  Object.assign(state.glossaryTermEditor, editable, {
    researchOrigin: { studyId: s.id, changes, scope: s.scope, teamId: s.scope.teamId, glossaryId: s.scope.glossaryId } });
  renderStudio();
}

async function startQueuedEntry(parent) {
  const queued = parent.queue.find((q) => q.status === "queued");
  if (!queued) { parent.status = "complete"; await persist(parent); renderStudio(); return; }
  studioView().modal = { kind: "queue", compounds: parent.queue.filter((q) => q.status === "queued").flatMap((q) => q.forms) };
  renderStudio();
}

export async function continueQueue() {
  const view = studioView();
  if (view.openingQueue) return;
  const parent = view.study;
  const item = parent?.queue.find((q) => q.status === "queued");
  if (!item) return;
  view.openingQueue = true; renderStudio();
  try {
    let child;
    if (item.studyId) child = await loadStudioStudy(parent.scope, item.studyId);
    else {
      child = newStudioStudy({ ...parent.scope, term: item.forms[0], forms: item.forms });
      child.parentId = parent.id; child.queueItemId = item.id; child.model = parent.model;
      child.forms = item.forms.map((text) => ({ text, selected: true }));
      child.meanings = parent.meanings.filter((m) => m.id === item.meaningId).map((m) => ({ ...m, splitOff: false }));
      child.passages = item.passages;
      child.assignments = item.assignments.map((a) => ({ ...a, entryId: "original" }));
      child.step = "5"; item.studyId = child.id; await persist(parent); await persist(child);
    }
    const runtimeVersion = await translatorRuntimeVersion();
    if (child.translationRuntimeVersion !== runtimeVersion && child.steps["9"]) child.steps["9"].status = "stale";
    child.translationRuntimeVersion = runtimeVersion;
    child.temporaryEntries = temporaryGlossaryTerms(parent).filter((entry) => entry.termId !== item.id);
    if (activeMeanings(parent).length) child.temporaryEntries.push({ ...buildStudioDraft(parent), termId: `parent-${parent.id}` });
    await persist(child);
    if (!contextMatches(parent) || state.screen !== "glossaryResearchStudio") return;
    view.study = child; view.modal = null;
    if (studioCanRecommendSkip(child.step)) {
      if (!await stepIsReusable(child, child.step)) await recommendCurrentStep();
    } else await runCurrentStage();
  } finally { view.openingQueue = false; renderStudio(); }
}

async function returnAfterEditor(event, origin, value) {
  let s = studioView().study;
  const current = s?.id === origin.studyId && contextMatches(s);
  const visible = current && ["glossaryEditor", "glossaryResearchStudio"].includes(state.screen)
    && (!state.glossaryTermEditor.isOpen || state.glossaryTermEditor.researchOrigin?.studyId === s.id);
  if (!current) {
    if (!origin.scope) return;
    s = await loadStudioStudy(origin.scope, origin.studyId);
  }
  if (event === "back" || event === "cancel") {
    s.editorDraft = value; s.editorDraftSignature = stableSignature(s.draft);
  }
  if (event === "saved") {
    s.savedTermId = value?.termId; s.editorDraft = null; s.editorDraftSignature = null;
    await approveStep(s, "11", { savedTermId: s.savedTermId, entry: value });
  }
  if (event === "saved" && visible) await refreshStudioGlossary(s.scope);
  s.step = event === "back" ? "10b" : "12";
  if (event !== "back" && s.parentId) {
    if (event === "saved" && !s.queue.some((item) => item.status === "queued")) s.status = "complete";
    await persist(s);
    const parent = await loadStudioStudy(s.scope, s.parentId);
    const item = parent.queue.find((q) => q.id === s.queueItemId);
    if (item) {
      item.status = event === "saved" ? "saved" : "cancelled";
      if (event === "saved") { item.targetTerms = value.targetTerms; item.forms = value.sourceTerms; }
    }
    if (visible) studioView().study = parent;
    parent.step = "12"; await persist(parent);
  } else await persist(s);
  if (visible) { state.screen = "glossaryResearchStudio"; renderStudio(); }
}
// Step 9's entry under test, edited in the term editor. A change replaces the stuck AI
// repair question; Resume then validates the edited entry.
function openEntryEditor(s, finding) {
  if (studioView().busy || s.step !== "9") throw new Error("Pause research before editing the entry.");
  const [paragraphId, occurrenceId] = finding.split(":").map(decodeURIComponent);
  const meaningId = s.assignments.find((a) => a.paragraphId === paragraphId && a.occurrenceId === occurrenceId)?.meaningId;
  const meanings = activeMeanings(s);
  openStudioEntryEditor(renderStudio, buildStudioDraft(s), { studyId: s.id, meaningId,
    sourceLanguage: s.scope.sourceLanguage, targetLanguage: s.scope.targetLanguage,
    notice: `This edits the entry tested in step 9. The glossary is changed only when you save the entry in step 11. Source variants come from step 2a.${meanings.length > 1 && meanings.some((m) => m.id === meaningId) ? ` New translations are added to meaning ${meaningNumber(s, meaningId)}.` : ""}` });
}

async function saveEditedEntry(origin, edit) {
  const s = studioView().study;
  if (s?.id !== origin.studyId || !contextMatches(s) || studioView().busy || s.step !== "9") throw new Error("Pause research before editing the entry.");
  const before = stableSignature(buildStudioDraft(s));
  applyStudioEntryEdit(s, edit, origin.meaningId);
  if (stableSignature(buildStudioDraft(s)) === before) return;
  if (s.pendingDecision?.kind === "selection") { s.pendingDecision = null; s.status = "active"; studioView().hideDecision = false; }
  await persist(s);
}

// The human's verdict on a step 9 finding. Once every batch in the stuck question
// passes, the question no longer applies; current results then complete step 9
// without new translations.
async function reviewFinding(s, name) {
  if (studioView().busy || s.step !== "9") throw new Error("Pause research before reviewing a finding.");
  const action = name.slice("review-".length, name.indexOf(":"));
  const [paragraphId, occurrenceId] = name.slice(name.indexOf(":") + 1).split(":").map(decodeURIComponent);
  reviewStudioFinding(s, action, paragraphId, occurrenceId);
  const d = s.pendingDecision;
  if (d?.kind === "selection" && (d.keys ?? [d.key]).every((key) => s.tests[key]?.passed)) {
    s.pendingDecision = null; s.status = "active"; studioView().hideDecision = false;
  }
  await persist(s);
  if (!s.pendingDecision && entryTrialsAreCurrent(s) && !s.steps["9"]?.value?.complete) await runCurrentStage();
  else renderStudio();
}

// Reviewing a stuck question yourself opens the first stuck batch's findings.
function revealStudioFindings(keys) {
  const details = [...(globalThis.document?.querySelectorAll?.("details[data-studio-disclosure]") ?? [])]
    .find((element) => keys.includes(element.dataset.studioDisclosure));
  if (!details) return;
  details.open = true;
  (details.querySelector(".studio-findings") ?? details).scrollIntoView({ block: "start" });
}

setStudioEditorHandler((event, origin, value) => event === "entry" ? saveEditedEntry(origin, value) : returnAfterEditor(event, origin, value));

export async function backStudio() {
  const s = studioView().study; if (!s) { state.screen = "glossaryEditor"; renderStudio(); return; }
  if (s.step !== "1") {
    await visitStudioStep(STUDIO_STEPS[STUDIO_STEPS.findIndex((step) => step.id === s.step) - 1].id);
    return;
  }
  const generation = ++operationGeneration;
  currentTiming?.finish("paused"); await currentTools?.cancel();
  if (studioView().study !== s || generation !== operationGeneration) return;
  if (s.step === "1") { await persist(s); studioView().study = null; studioView().history = await loadStudioHistory(currentScope()); }
  else {
    s.step = STUDIO_STEPS[Math.max(0, STUDIO_STEPS.findIndex((step) => step.id === s.step) - 1)].id;
    await hydrateStudioStep(s, s.step);
    if (studioView().study !== s || generation !== operationGeneration) return;
    await persist(s);
  }
  if (generation === operationGeneration) { studioView().busy = false; studioView().message = ""; renderStudio(); }
}

export async function skipStudio(confirmed = false) {
  const s = studioView().study; if (!s) return;
  const step = STUDIO_STEPS.find((step) => step.id === s.step);
  if (!step.optional && s.step !== "4.4.4") return;
  const generation = ++operationGeneration;
  currentTiming?.finish("paused"); await currentTools?.cancel();
  if (studioView().study !== s || generation !== operationGeneration) return;
  if (s.step === "4.4.4") {
    if (!confirmed) {
      studioView().busy = false; studioView().modal = { kind: "skip", label: "source research" }; renderStudio(); return;
    }
    studioView().modal = null;
    for (const id of ["4.4.1", "4.4.2", "4.4.4"]) await approveStep(s, id, { skipped: true });
    studioView().busy = false;
    await moveTo(s, "4.5"); return;
  }
  if (!confirmed && ["4.3"].includes(s.step) && studioView().busy) {
    studioView().busy = false; studioView().modal = { kind: "skip", label: step.label }; renderStudio(); return;
  }
  studioView().modal = null;
  if (s.step === "2a") s.forms = uniqueSourceTexts([s.scope.term, ...s.scope.forms], s.scope.sourceLanguage.code).map((text) => ({ text, selected: true }));
  await approveStep(s, s.step, { skipped: true });
  const next = STUDIO_STEPS[STUDIO_STEPS.findIndex((step) => step.id === s.step) + 1];
  studioView().busy = false; await moveTo(s, next.id);
}

export async function pauseStudio() {
  const generation = ++operationGeneration; const s = studioView().study;
  try { currentTiming?.finish("paused"); await currentTools?.cancel(); await persist(s); }
  finally {
    if (generation === operationGeneration && studioView().study === s) {
      studioView().busy = false; studioView().message = ""; renderStudio();
    }
  }
}

async function exitStudio() {
  const generation = ++operationGeneration;
  studioView().openingStudyId = null;
  currentTiming?.finish("paused"); await currentTools?.cancel();
  await persist();
  studioView().busy = false;
  // Studio saves have already synced. End the earlier editor session before its
  // dirty flag can defer the fresh snapshot when reopening the same glossary.
  await syncAndStopGlossaryBackgroundSyncSession(renderStudio);
  if (generation !== operationGeneration) return;
  await openGlossaryEditor(renderStudio, state.glossaryEditor.glossaryId);
}

export function updateStudioInput(target) {
  const s = studioView().study; if (!s) return;
  const field = target.dataset.studioField;
  const path = field?.split(".");
  const owner = path?.slice(0, -1).reduce((value, key) => value?.[key], s);
  let proposed = target.type === "checkbox" ? target.checked : target.type === "number" ? Number(target.value) : target.value;
  let previous = field ? owner?.[path.at(-1)] : undefined;
  if (field === "scope.forms") proposed = uniqueSourceTexts(target.value.split(/[\n,]/u), s.scope.sourceLanguage.code);
  if (field === "scope.projectIds") proposed = [...target.selectedOptions].map((option) => option.value);
  if (/^candidates\.\d+\.meaningIds$/u.test(field) && target.dataset.studioMeaning) {
    const meanings = owner.selected === false ? [] : previous;
    proposed = target.checked ? uniqueTexts([...meanings, target.dataset.studioMeaning]) : meanings.filter((id) => id !== target.dataset.studioMeaning);
  }
  if (target.dataset.studioBranch) previous = studioView().branch;
  if (target.dataset.studioMerge) previous = studioView().mergeDestinations[target.dataset.studioMerge];
  if (target.dataset.studioCollision) previous = s.collisions[target.dataset.studioCollision];
  const researchChange = Boolean(field || target.dataset.studioBranch || target.dataset.studioMerge || target.dataset.studioCollision)
    && stableSignature(previous) !== stableSignature(proposed);
  if (!researchChange && (field || target.dataset.studioBranch || target.dataset.studioMerge || target.dataset.studioCollision)) return;
  if (researchChange) {
    // Input events occur after the control changes, but before study state does.
    // Re-render the saved value while the proposed edit awaits confirmation.
    const pending = { dataset: { ...target.dataset }, type: target.type, tagName: target.tagName,
      value: target.value, checked: target.checked, selectedOptions: [...(target.selectedOptions ?? [])].map((option) => ({ value: option.value })) };
    if (requestStudioRedo(() => updateStudioInput(pending))) return;
    markStudioEdited(s);
  }
  const renderInputChange = () => {
    const document = globalThis.document;
    const wasFocused = document?.activeElement === target;
    const identity = ["studioField", "studioMeaning", "studioBranch", "studioCollision", "studioDecision"]
      .filter((key) => target.dataset[key] !== undefined).map((key) => [key, target.dataset[key]]);
    renderStudio();
    if (wasFocused && identity.length) {
      const replacement = [...document.querySelectorAll("[data-studio-field], [data-studio-branch], [data-studio-collision], [data-studio-decision]")]
        .find((element) => identity.every(([key, value]) => element.dataset[key] === value));
      replacement?.focus({ preventScroll: true });
    }
  };
  if (field) {
    const path = field.split("."); let owner = s;
    for (const key of path.slice(0, -1)) owner = owner[key];
    const key = path.at(-1);
    const previous = owner[key];
    if (/^candidates\.\d+\.meaningIds$/u.test(field) && target.dataset.studioMeaning) {
      owner.proposedMeaningIds ??= [...previous];
      const meanings = owner.selected === false ? [] : previous;
      owner.selected = true;
      owner[key] = target.checked ? uniqueTexts([...meanings, target.dataset.studioMeaning])
        : meanings.filter((id) => id !== target.dataset.studioMeaning);
    } else owner[key] = target.type === "checkbox" ? target.checked : target.type === "number" ? Number(target.value) : target.value;
    if (/^forms\.\d+\.selected$/u.test(field)) owner.selectionOverride = target.checked;
    if (/^candidates\.\d+\.text$/u.test(field)) {
      for (const input of globalThis.document?.querySelectorAll?.("[data-studio-field]") ?? []) {
        if (input.dataset.studioField !== field) continue;
        if (input !== target) input.value = owner.text;
        const note = input.closest?.(".studio-candidate")?.querySelector?.("[data-studio-shared-note]");
        if (note) note.dataset.studioSharedNote = owner.text;
      }
      for (const label of globalThis.document?.querySelectorAll?.("[data-studio-candidate-text]") ?? []) {
        if (label.dataset.studioCandidateText === path[1]) label.textContent = owner.text || "New translation";
      }
    }
    if (target.dataset.studioSharedNote && /^candidates\.\d+\.note$/u.test(field)) {
      for (const candidate of s.candidates) if (candidate.text === owner.text) candidate.note = target.value;
      // Update duplicate visible fields without replacing the input being edited.
      for (const input of globalThis.document?.querySelectorAll?.("[data-studio-shared-note]") ?? []) {
        if (input !== target && input.dataset.studioSharedNote === owner.text) input.value = target.value;
      }
    }
    if (target.dataset.studioRetainText && /^candidates\.\d+\.retained$/u.test(field)) {
      for (const candidate of s.candidates) if (candidate.text === target.dataset.studioRetainText) candidate.retained = target.checked;
    }
    if (["8", "9"].includes(s.step) && previous !== owner[key] && (field === "generalNote" || /^candidates\.\d+\.note$/u.test(field))) {
      const runButton = globalThis.document?.querySelector('[data-action="studio:run"]');
      const nextButton = globalThis.document?.querySelector('[data-action="studio:next"]');
      for (const [button, disabled] of [[runButton, Boolean(s.pendingDecision)], [nextButton, true]]) {
        if (!button) continue;
        button.disabled = disabled;
        button.classList.toggle("is-disabled", disabled);
        for (const attribute of ["aria-disabled", "data-offline-blocked"]) {
          if (disabled) button.setAttribute(attribute, "true");
          else button.removeAttribute(attribute);
        }
      }
    }
    if (/^forms\.\d+\.text$/u.test(field) && previous !== owner[key]) {
      delete owner.paragraphCount; delete owner.found; delete owner.discoveryStatus; delete owner.reason;
    }
    if (field === "scope.forms") owner[key] = uniqueSourceTexts(target.value.split(/[\n,]/u), s.scope.sourceLanguage.code);
    if (field === "scope.projectIds") owner[key] = [...target.selectedOptions].map((o) => o.value);
    if (s.status === "complete" && stableSignature(previous) !== stableSignature(owner[key])) s.status = "active";
    if (target.type === "checkbox" || target.tagName === "SELECT") renderInputChange();
  }
  if (target.dataset.studioBranch) { studioView().branch = target.value; s.branch = target.value; }
  if (target.dataset.studioMerge) {
    studioView().mergeDestinations[target.dataset.studioMerge] = target.value;
    s.mergeDestinations = { ...studioView().mergeDestinations };
  }
  if (target.dataset.studioCollision) s.collisions[target.dataset.studioCollision] = target.value;
  if (target.dataset.studioDecision) s.decisionInput ??= {};
  if (target.dataset.studioDecision) s.decisionInput[target.dataset.studioDecision] = target.type === "checkbox" ? target.checked : target.value;
  if (target.dataset.studioBranch || target.dataset.studioCollision
    || (target.dataset.studioDecision && target.tagName === "SELECT")) renderInputChange();
  globalThis.clearTimeout(editSaveTimer);
  editSaveTimer = globalThis.setTimeout(() => persist(s).catch((error) => {
    studioView().error = `Research changes could not be saved: ${error.message}`;
    renderStudio();
  }), 400);
}

export async function resolveStudioDecision(action) {
  const s = studioView().study; const d = s.pendingDecision;
  if (!d) return;
  if (d.kind === "progress") {
    if (action === "stop") { studioView().hideDecision = true; s.status = "paused"; await persist(s); return; }
    s.reports[d.reportKey].continued = true;
  } else if (d.kind === "selection") {
    if (action === "stop") {
      studioView().hideDecision = true; s.status = "paused"; await persist(s);
      renderStudio(); revealStudioFindings(d.keys ?? [d.key]); return;
    }
    s.retryAllowances ??= {};
    for (const key of d.keys ?? [d.key]) s.retryAllowances[key] = (s.rounds[key] ?? d.rounds) + 3;
  } else if (d.kind === "candidate") {
    if (action === "approve") {
      for (const c of s.candidates) if (c.groupId === d.groupId) c.temporary = false;
    } else {
      const replacements = uniqueTexts((s.decisionInput?.candidate ?? "").split(/[\n,]/u));
      if (!replacements.length) throw new Error("Enter a target word or its inflections.");
      s.candidates = s.candidates.filter((c) => c.groupId !== d.groupId);
      s.candidates.push(...replacements.map((text, i) => ({ id: `${d.groupId}-human-${i}`, groupId: d.groupId,
        text, note: "", meaningIds: [d.meaningId], confirmed: true, selected: true, retained: true })));
    }
  } else if (d.kind === "unmatched") {
    if (action === "drop") {
      if (s.passages.length === 1) { studioView().modal = { kind: "lastParagraph" }; renderStudio(); return; }
      s.passages = s.passages.filter((p) => p.id !== d.paragraphId);
      s.excludedParagraphIds ??= []; s.excludedParagraphIds.push(d.paragraphId);
      s.assignments = s.assignments.filter((a) => a.paragraphId !== d.paragraphId);
    } else {
      let id = s.decisionInput?.meaning;
      if (action === "new") {
        const definition = s.decisionInput?.definition || d.recommendation.definition;
        id = `human-${s.meanings.length}`; s.meanings.push({ id, definition, enabled: true });
      }
      if (!s.meanings.some((m) => m.id === id)) throw new Error("Select a definition.");
      const a = s.assignments.find((a) => a.paragraphId === d.paragraphId && a.occurrenceId === d.occurrenceId);
      a.meaningId = id;
    }
  }
  s.pendingDecision = null; s.status = "active"; studioView().hideDecision = false;
  s.decisionInput = {}; await persist(s); await runCurrentStage();
}

// Unanswered AI advice is taken after a countdown, as if its button were clicked.
const startAutoChoice = () => startStudioAutoChoice(studioView, (choice) => studioAction(`studio:${choice}`, renderStudio));

export async function studioAction(action, render) {
  renderStudio = render;
  if (action === "open-glossary-research") { await openStudio(render); return true; }
  if (!action.startsWith("studio:")) return false;
  startAutoChoice();
  // Any action shows the translator is here, and the timer must not overtake a
  // slow one such as leaving the studio, so pending advice waits for them.
  answerStudioAutoChoice(studioView());
  if (action === "studio:export") { await exportCurrentResearch(); return true; }
  await guarded(async () => {
    const name = action.slice(7); const s = studioView().study;
    if (name === "confirm-redo") {
      const modal = studioView().modal;
      if (modal?.kind !== "redo" || modal.study !== s || modal.step !== s.step || modal.continuing) return;
      if (!contextMatches(s) || !canWriteGlossaries(selectedTeam())) throw new Error("Reopen this study with glossary write access before changing its research.");
      modal.continuing = true;
      const decisionInput = s.decisionInput;
      clearStudioDependents(s, modal.step);
      if (modal.previousModal?.kind === "meaningReview") s.decisionInput = decisionInput;
      delete s.reviewNavigation;
      studioView().reviewFrontier = STUDIO_STEPS.findIndex((item) => item.id === modal.step);
      studioView().revisiting = false; studioView().decisionStep = null; studioView().hideDecision = false;
      studioView().branch = s.branch ?? STUDIO_DEFAULT_BRANCH; studioView().mergeDestinations = s.mergeDestinations ?? {};
      studioView().modal = modal.previousModal;
      await persist(s);
      await modal.operation(); render(); return;
    }
    let changesResearch = ["run", "redo", "recheck-forms", "skip", "confirm-skip", "expand-recovery", "add-form", "add-meaning", "save-assignment", "load-context"].includes(name)
      || ["expand-meaning:", "select-splits:", "add-candidate:", "candidate-up:", "candidate-first:", "add-inflection:", "all-collisions:"].some((prefix) => name.startsWith(prefix));
    if (s && name.startsWith("select-splits:")) changesResearch = (s.splitProposals ?? []).some((proposal) => proposal.selected !== (name.slice(14) === "all"));
    if (s && name.startsWith("all-collisions:")) changesResearch = sourceCollisions(s, studioGlossaryEntries(s.scope)).some(({ form }) => s.collisions[form] !== name.slice(15));
    if (s && name === "save-assignment" && studioView().modal?.kind === "meaningReview") {
      const modal = studioView().modal;
      const assignment = s.assignments.find((item) => item.paragraphId === modal.paragraphId && item.occurrenceId === modal.occurrenceId);
      changesResearch = assignment && (assignment.meaningId !== s.decisionInput?.meaningReview
        || Boolean(assignment.preserveSourceSpelling) !== Boolean(s.decisionInput?.preserveSourceSpelling));
    }
    if (s && name === "skip" && studioView().revisiting && s.steps[s.step]?.status === "skipped") {
      const next = STUDIO_STEPS[STUDIO_STEPS.findIndex((item) => item.id === s.step) + 1];
      if (next && studioCanVisitStep(s, next.id)) { await visitStudioStep(next.id); return; }
    }
    if (s && changesResearch && (!studioView().busy || studioView().recommendationRequest) && requestStudioRedo(() => studioAction(action, render))) return;
    if (s && changesResearch && !["run", "redo"].includes(name)) markStudioEdited(s);
    if (s && ["run", "skip"].includes(name)) await abandonRecommendation();
    if (name === "new") await newStudy();
    else if (name.startsWith("visit:")) await visitStudioStep(name.slice(6));
    else if (name.startsWith("resume:")) await resumeStudy(name.slice(7));
    else if (name.startsWith("delete:")) {
      studioView().openingStudyId = null;
      if (s) return;
      const study = studioView().history.find((entry) => entry.id === name.slice(7));
      if (!study) throw new Error("This study is no longer in research history. Reopen the history page.");
      studioView().modal = { kind: "delete", study, scope: currentScope() }; render();
    }
    else if (name === "confirm-delete") await deleteSavedStudy();
    else if (name === "compare-budgets") {
      if (studioView().busy || s.status !== "complete") return;
      studioView().busy = true; render();
      let comparison;
      try { comparison = await budgetComparison(s, (value) => resolveStudioEvidence(s, value)); }
      finally { studioView().busy = false; }
      operationGeneration += 1; studioView().study = comparison; studioView().modal = null;
      await persist(comparison); await persist(comparison); await runCurrentStage();
    }
    else if (name === "counterfactual") {
      if (studioView().busy || s.budgetComparisonPhase !== "complete") return;
      studioView().busy = true; render();
      const timing = createStudioStepTiming(s, "counterfactual"); const generation = operationGeneration;
      const tools = toolsFor(s, timing); currentTiming = timing; currentTools = tools;
      try {
        const reference = await resolveStudioEvidence(s, s.comparisonReference);
        s.comparisonResults.counterfactual = await testOmittedInterpretation(s, reference, tools);
        s.counterfactualSummary = { ...s.comparisonResults.counterfactual.verdict, translation: s.comparisonResults.counterfactual.translations[0].translation };
        timing.finish("complete"); await persist(s);
      } catch (error) { timing.finish("failed"); throw error; }
      finally {
        if (currentTiming === timing) currentTiming = null;
        if (currentTools === tools) currentTools = null;
        if (contextMatches(s) && generation === operationGeneration) studioView().busy = false;
        render();
      }
    }
    else if (name === "budget-next") {
      if (studioView().busy || !s.referenceStudyId) return;
      if (s.budgetComparisonPhase === "bibliography") {
        s.comparisonResults.bibliography = structuredClone(s.steps["4.4.1"].value);
        s.budgetComparisonPhase = "assignment";
        await moveTo(s, "4.6");
      } else if (s.budgetComparisonPhase === "assignment") {
        const reference = await resolveStudioEvidence(s, s.comparisonReference);
        referenceForTranslationTests(s, reference);
        await approveStep(s, "4.6", { meanings: s.meanings, assignments: s.assignments, paragraphs: s.passages.length, referenceSourceStudyId: reference.sourceStudyId });
        await persist(s); await moveTo(s, "8");
      } else if (s.step === "9" && s.steps["9"]?.value?.complete) {
        s.budgetComparisonPhase = "complete"; s.status = "complete"; await persist(s);
      }
    }
    else if (name.startsWith("reading:")) await readingTranslation(name.slice(8));
    else if (name === "cancel-reading") { studioView().readingOperation = null; studioView().readingBusy = null; const previous = readingTools; readingTools = null; await previous?.cancel(); render(); }
    else if (name === "expand-recovery") {
      if (studioView().busy || s.step !== "4.6") return;
      s.recoveryBudget = Math.min(500, Math.max(s.recoveryBudget ?? 100, s.recoveryConsidered ?? 0) + 100);
      s.steps["4.6"] = { ...s.steps["4.6"], status: "stale", generatedSignature: null };
      await persist(s); await runCurrentStage();
    }
    else if (name.startsWith("expand-meaning:")) {
      if (studioView().busy || s.step !== "8") return;
      s.focusedSampleLimits ??= {}; s.focusedSampleLimits[name.slice(15)] = Number.MAX_SAFE_INTEGER;
      s.steps["8"] = { ...s.steps["8"], status: "stale", generatedSignature: null };
      await persist(s); await runCurrentStage();
    }
    else if (name === "recommend") {
      if (!studioView().saving) await recommendCurrentStep(s.step !== "2a");
    }
    else if (name === "run") await runCurrentStage();
    else if (name === "redo") await runCurrentStage(true);
    else if (name === "recheck-forms" && s.step === "2a" && !studioView().busy) {
      s.scope.forms = uniqueSourceTexts([...s.scope.forms, ...s.forms.map((f) => f.text)], s.scope.sourceLanguage.code);
      if (s.steps["2a"]) { s.steps["2a"].status = "stale"; s.steps["2a"].generatedSignature = null; }
      await runCurrentStage();
    }
    else if (name === "next") await advanceStudio();
    else if (name === "back") await backStudio();
    else if (name === "exit") await exitStudio();
    else if (name === "editor-back") {
      const draft = structuredClone(state.glossaryTermEditor);
      if (draft.failedIntentKey) clearFailedGlossaryTermWrite(draft.failedIntentKey);
      resetGlossaryTermEditor();
      await returnAfterEditor("back", draft.researchOrigin, draft);
    }
    else if (name === "pause") await pauseStudio();
    else if (name === "review-decision") { studioView().hideDecision = false; render(); }
    else if (name === "load-context") await loadSourceContext();
    else if (name.startsWith("view-source:")) await viewSourceParagraph(name.slice(12));
    else if (/^review-(accept|ignore|undo):/u.test(name)) await reviewFinding(s, name);
    else if (name.startsWith("edit-entry:")) openEntryEditor(s, name.slice("edit-entry:".length));
    else if (name.startsWith("review-assignment:")) {
      if (studioView().busy) throw new Error("Pause research before reviewing a meaning.");
      const [paragraphId, occurrenceId] = name.slice("review-assignment:".length).split(":").map(decodeURIComponent);
      const assignment = s.assignments.find((a) => a.paragraphId === paragraphId && a.occurrenceId === occurrenceId);
      if (!assignment) throw new Error("This occurrence is no longer part of the study.");
      s.decisionInput ??= {}; s.decisionInput.meaningReview = assignment.meaningId;
      s.decisionInput.preserveSourceSpelling = Boolean(assignment.preserveSourceSpelling);
      studioView().modal = { kind: "meaningReview", paragraphId, occurrenceId }; render();
    }
    else if (name === "save-assignment") {
      const modal = studioView().modal;
      if (modal?.kind !== "meaningReview" || studioView().busy || studioView().savingAssignment || modal.loadingContext) return;
      studioView().savingAssignment = true; render();
      try {
        await hydrateStudioStep(s, "4.6");
        if (!contextMatches(s) || studioView().modal !== modal) return;
        await reviseAssignment(s, modal.paragraphId, modal.occurrenceId, s.decisionInput?.meaningReview, Boolean(s.decisionInput?.preserveSourceSpelling));
        s.error = ""; studioView().error = "";
        await persist(s); studioView().modal = null;
      }
      finally { studioView().savingAssignment = false; render(); }
    }
    else if (name === "retest-meanings") {
      if (studioView().busy || !s.assignmentReviewPending) return;
      s.error = ""; studioView().error = "";
      await moveTo(s, "8");
    }
    else if (name === "skip") await skipStudio();
    else if (name === "confirm-skip") await skipStudio(true);
    else if (name === "queue") await continueQueue();
    else if (name === "close-modal" && studioView().modal?.kind === "redo") {
      studioView().modal = studioView().modal.previousModal;
      render();
    }
    else if (name === "close-modal" && !studioView().deletingStudyId && !studioView().savingAssignment && !studioView().openingQueue) {
      studioView().modal = null;
      const tools = sourceContextTools; sourceContextTools = null;
      await tools?.cancel(); await persist();
    }
    else if (name === "cancel-last") { s.status = "cancelled"; s.pendingDecision = null; studioView().modal = null; await persist(); }
    else if (name.startsWith("decision:")) await resolveStudioDecision(name.slice(9));
    else if (name === "add-form") { s.forms.push({ text: "", selected: true }); render(); }
    else if (name.startsWith("select-splits:") && s.step === "4.7") {
      for (const proposal of s.splitProposals ?? []) proposal.selected = name.slice(14) === "all";
      render(); await persist(s);
    }
    else if (name === "add-meaning") { s.meanings.push({ id: `human-${s.meanings.length}`, definition: "", enabled: true }); render(); }
    else if (name.startsWith("add-candidate:")) { s.candidates.push({ id: `human-${s.candidates.length}`, text: "", meaningIds: [name.slice(14)], selected: true, retained: true }); render(); }
    else if (name.startsWith("candidate-up:") || name.startsWith("candidate-first:")) {
      preferCandidate(s, Number(name.slice(name.indexOf(":") + 1)), name.startsWith("candidate-first:"));
      render(); await persist();
    }
    else if (name.startsWith("add-inflection:")) {
      const index = Number(name.slice(15)); const candidate = s.candidates[index];
      if (!candidate) throw new Error("Choose a translation before adding an inflection.");
      candidate.groupId ||= `word-${candidate.id}`;
      s.candidates.splice(index + 1, 0, { id: `inflection-${globalThis.crypto.randomUUID()}`, text: "", note: candidate.note ?? "",
        meaningIds: [...candidate.meaningIds], proposedMeaningIds: [...(candidate.proposedMeaningIds ?? candidate.meaningIds)],
        groupId: candidate.groupId, selected: true, confirmed: false, retained: true });
      render(); await persist();
    }
    else if (name.startsWith("all-collisions:")) {
      const choice = name.slice(15);
      for (const { form } of sourceCollisions(s, studioGlossaryEntries(s.scope))) s.collisions[form] = choice;
      render();
    }
  // The delegated operation owns its busy state; an older action can finish
  // after Pause and Resume have already started another run on the same study.
  }, null, false);
  return true;
}

async function exportCurrentResearch() {
  const view = studioView(); const study = view.study;
  if (!study || view.exporting) return;
  view.exporting = true; renderStudio();
  try {
    const save = globalThis.window?.__TAURI__?.dialog?.save;
    if (typeof save !== "function") throw new Error("The native file save dialog is not available.");
    const term = String(study.scope.term ?? "").replace(/[<>:"/\\|?*\x00-\x1f]/gu, "-").trim().replace(/\.+$/u, "").slice(0, 80) || study.id;
    const outputPath = await save({ title: "Export research", defaultPath: `glossary-research-${term}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }] });
    if (!outputPath) return;
    await exportStudioStudy(study, outputPath);
    showNoticeBadge("Research exported.", renderStudio);
  } catch (error) {
    showNoticeBadge(error?.message ?? String(error), renderStudio, 6000);
  } finally { view.exporting = false; renderStudio(); }
}
