import { invoke } from "./runtime.js";
import {
  createGlossaryTermEditorState,
  resetGlossaryTermEditor,
  state,
} from "./state.js";
import {
  markGlossaryBackgroundSyncDirty,
  maybeStartGlossaryBackgroundSync,
} from "./glossary-background-sync.js";
import { clearScopedSyncBadge, showNoticeBadge, showScopedSyncBadge } from "./status-feedback.js";
import {
  GLOSSARY_EMPTY_TARGET_VARIANT_SENTINEL,
  canManageGlossaries,
  normalizeEditableTerms,
  normalizeEditableTargetTerms,
  sanitizeEditableTargetTerms,
  sanitizeEditableTerms,
  selectedGlossary,
  selectedGlossaryRepoName,
  selectedTeam,
  updateGlossaryTermArray,
} from "./glossary-shared.js";
import { extractGlossaryRubyBaseText } from "./glossary-ruby.js";
import {
  ensureGlossaryNotTombstoned,
  getGlossarySyncIssueMessage,
  syncSingleGlossaryForTeam,
} from "./glossary-repo-flow.js";
import {
  buildGlossaryTermFromDraft,
  ensureGlossaryTermReadyForEdit,
  findGlossaryTermById,
  markVisibleGlossaryTermConfirmed,
  markVisibleGlossaryTermFailed,
  removeVisibleGlossaryTerm,
  upsertVisibleGlossaryTerm,
} from "./glossary-term-sync.js";
import {
  glossaryTermSaveIntentKey,
  glossaryTermWriteScope,
  requestGlossaryTermWriteIntent,
} from "./glossary-term-write-coordinator.js";

const SOURCE_TERM_DUPLICATE_WARNING =
  "The terms highlighted in red below are redundant with other parts of this glossary. Please remove them before saving.";
const GLOSSARY_TERM_REMOTE_UPDATE_NOTICE =
  "Error: this glossary term has a more recent version on GitHub. Please redo your edits and save again.";
const GLOSSARY_EDITOR_STATUS_SCOPE = "glossaryEditor";

let nextOptimisticGlossaryTermId = 1;

function normalizeSourceTermForDuplicateDetection(value) {
  return extractGlossaryRubyBaseText(value).trim();
}

function findRedundantSourceVariantIndices(
  sourceTerms = state.glossaryTermEditor?.sourceTerms,
  glossaryTerms = state.glossaryEditor?.terms,
  termId = state.glossaryTermEditor?.termId,
) {
  const candidateTerms = Array.isArray(sourceTerms) ? sourceTerms : [];
  const candidateCounts = new Map();
  const existingTerms = new Set();

  for (const glossaryTerm of Array.isArray(glossaryTerms) ? glossaryTerms : []) {
    if (!glossaryTerm || glossaryTerm.lifecycleState === "deleted" || glossaryTerm.termId === termId) {
      continue;
    }

    for (const sourceTerm of Array.isArray(glossaryTerm.sourceTerms) ? glossaryTerm.sourceTerms : []) {
      const normalized = normalizeSourceTermForDuplicateDetection(sourceTerm);
      if (normalized) {
        existingTerms.add(normalized);
      }
    }
  }

  for (const sourceTerm of candidateTerms) {
    const normalized = normalizeSourceTermForDuplicateDetection(sourceTerm);
    if (!normalized) {
      continue;
    }

    candidateCounts.set(normalized, (candidateCounts.get(normalized) ?? 0) + 1);
  }

  return candidateTerms.reduce((indices, sourceTerm, index) => {
    const normalized = normalizeSourceTermForDuplicateDetection(sourceTerm);
    if (!normalized) {
      return indices;
    }

    if ((candidateCounts.get(normalized) ?? 0) > 1 || existingTerms.has(normalized)) {
      indices.push(index);
    }

    return indices;
  }, []);
}

function syncGlossaryTermDuplicateFeedbackDom() {
  if (typeof document === "undefined") {
    return;
  }

  const redundantIndices = new Set(state.glossaryTermEditor?.redundantSourceVariantIndices ?? []);
  document
    .querySelectorAll('[data-glossary-term-variant-input][data-variant-side="source"]')
    .forEach((element) => {
      const index = Number.parseInt(element.dataset.variantIndex ?? "", 10);
      element.classList.toggle(
        "term-variant-row__input--redundant",
        Number.isInteger(index) && redundantIndices.has(index),
      );
    });

  const warning = document.querySelector("[data-glossary-term-duplicate-warning]");
  if (warning instanceof HTMLElement) {
    const warningText = state.glossaryTermEditor?.sourceTermDuplicateWarning ?? "";
    warning.hidden = !warningText;
    warning.textContent = warningText;
  }
}

function clearGlossaryTermDuplicateFeedback() {
  if (!state.glossaryTermEditor?.isOpen) {
    return;
  }

  state.glossaryTermEditor.sourceTermDuplicateWarning = "";
  state.glossaryTermEditor.redundantSourceVariantIndices = [];
}

function refreshGlossaryTermDuplicateFeedback({ activateWarning = false } = {}) {
  if (!state.glossaryTermEditor?.isOpen) {
    return false;
  }

  const redundantSourceVariantIndices = findRedundantSourceVariantIndices();
  if (redundantSourceVariantIndices.length > 0) {
    state.glossaryTermEditor.sourceTermDuplicateWarning = SOURCE_TERM_DUPLICATE_WARNING;
    state.glossaryTermEditor.redundantSourceVariantIndices = redundantSourceVariantIndices;
    syncGlossaryTermDuplicateFeedbackDom();
    return true;
  }

  if (activateWarning || state.glossaryTermEditor.sourceTermDuplicateWarning) {
    clearGlossaryTermDuplicateFeedback();
    syncGlossaryTermDuplicateFeedbackDom();
  }

  return false;
}

function shouldRefreshGlossaryTermDuplicateFeedback() {
  return Boolean(
    state.glossaryTermEditor?.sourceTermDuplicateWarning
      || (state.glossaryTermEditor?.redundantSourceVariantIndices?.length ?? 0) > 0,
  );
}

function createGlossaryTermEditorModalState(term = null, overrides = {}) {
  return {
    ...createGlossaryTermEditorState(),
    isOpen: true,
    status: overrides.status ?? "idle",
    error: overrides.error ?? "",
    notice: overrides.notice ?? "",
    glossaryId: state.glossaryEditor?.glossaryId ?? null,
    termId: overrides.termId ?? term?.termId ?? null,
    sourceTerms: normalizeEditableTerms(term?.sourceTerms ?? []),
    targetTerms: normalizeEditableTargetTerms(term?.targetTerms ?? []),
    sourceTermDuplicateWarning: "",
    redundantSourceVariantIndices: [],
    notesToTranslators: term?.notesToTranslators ?? "",
    footnote: term?.footnote ?? "",
    untranslated: term?.untranslated === true,
    attemptedDraft: overrides.attemptedDraft ?? null,
  };
}

async function reopenGlossaryTermEditorWithLatestRemote(render, termId) {
  const latestTerm = await ensureGlossaryTermReadyForEdit(render, termId, {
    suppressNotice: true,
  });
  if (!latestTerm) {
    resetGlossaryTermEditor();
    render();
    showNoticeBadge("The term was deleted on GitHub.", render);
    return false;
  }

  state.glossaryTermEditor = createGlossaryTermEditorModalState(latestTerm, {
    notice: GLOSSARY_TERM_REMOTE_UPDATE_NOTICE,
  });
  render();
  return true;
}

async function rollbackGlossaryTermSave(repoInput, previousHeadSha, failureMessage) {
  if (!previousHeadSha) {
    return failureMessage;
  }

  try {
    await invoke("rollback_gtms_glossary_term_upsert", {
      input: {
        installationId: repoInput.installationId,
        glossaryId: repoInput.glossaryId,
        repoName: repoInput.repoName,
        previousHeadSha,
      },
    });
    return `${failureMessage} The local glossary term change was rolled back.`;
  } catch (rollbackError) {
    const rollbackMessage = rollbackError instanceof Error
      ? rollbackError.message
      : String(rollbackError);
    return `${failureMessage} Rolling back the local glossary term change also failed: ${rollbackMessage}`;
  }
}

function nextOptimisticClientTermId() {
  const id = nextOptimisticGlossaryTermId;
  nextOptimisticGlossaryTermId += 1;
  return `optimistic-glossary-term-${Date.now().toString(36)}-${id}`;
}

function showGlossaryEditorStatus(render, text) {
  const normalizedText = String(text ?? "").trim();
  if (!normalizedText) {
    return;
  }
  showScopedSyncBadge(GLOSSARY_EDITOR_STATUS_SCOPE, normalizedText, render);
}

function clearGlossaryEditorStatus(render) {
  clearScopedSyncBadge(GLOSSARY_EDITOR_STATUS_SCOPE, render);
}

function restoreFailedGlossaryTermSave(render, intent, message) {
  const draftSnapshot = intent.value?.draftSnapshot ?? null;
  const visibleTermId = intent.value?.visibleTermId ?? draftSnapshot?.termId ?? null;
  if (intent.value?.isCreate) {
    removeVisibleGlossaryTerm(visibleTermId);
  } else if (visibleTermId) {
    markVisibleGlossaryTermFailed(visibleTermId, message);
  }

  state.glossaryTermEditor = createGlossaryTermEditorModalState(draftSnapshot, {
    error: message,
    termId: draftSnapshot?.termId ?? null,
  });
  render();
}

async function runGlossaryTermSaveIntent(render, intent) {
  try {
    const team = selectedTeam(intent.teamId);
    const glossary = selectedGlossary();
    const draftSnapshot = intent.value?.draftSnapshot;
    const repoInput = intent.value?.repoInput;
    if (!draftSnapshot || !repoInput || !Number.isFinite(team?.installationId)) {
      throw new Error("Could not determine which glossary term to save.");
    }

    let previousHeadSha = null;
    showGlossaryEditorStatus(render, "Checking remote glossary changes...");
    await maybeStartGlossaryBackgroundSync(render, { force: true });
    if (draftSnapshot.termId) {
      const currentTerm = findGlossaryTermById(draftSnapshot.termId, state.glossaryEditor);
      if (currentTerm?.freshness === "stale" || currentTerm?.remotelyDeleted === true) {
        markVisibleGlossaryTermFailed(draftSnapshot.termId, GLOSSARY_TERM_REMOTE_UPDATE_NOTICE);
        const reopened = await reopenGlossaryTermEditorWithLatestRemote(render, draftSnapshot.termId);
        if (reopened) {
          state.glossaryTermEditor.attemptedDraft = draftSnapshot;
        }
        throw new Error(GLOSSARY_TERM_REMOTE_UPDATE_NOTICE);
      }
    }

    showGlossaryEditorStatus(render, "Saving glossary term...");
    const upsertPayload = await invoke("upsert_gtms_glossary_term", {
      input: {
        ...repoInput,
        termId: draftSnapshot.termId,
        sourceTerms: draftSnapshot.sourceTerms,
        targetTerms: draftSnapshot.targetTerms,
        notesToTranslators: draftSnapshot.notesToTranslators,
        footnote: draftSnapshot.footnote,
        untranslated: draftSnapshot.untranslated,
      },
    });
    previousHeadSha = upsertPayload?.previousHeadSha ?? null;
    let syncIssue = null;
    try {
      showGlossaryEditorStatus(render, "Syncing glossary repo...");
      syncIssue = getGlossarySyncIssueMessage(
        await syncSingleGlossaryForTeam(team, glossary),
      );
    } catch (error) {
      const errorMessage = error?.message ?? String(error);
      showGlossaryEditorStatus(render, "Rolling back glossary term save...");
      const rollbackMessage = await rollbackGlossaryTermSave(repoInput, previousHeadSha, errorMessage);
      if (intent.previousValue) {
        markVisibleGlossaryTermConfirmed(intent.value.visibleTermId, intent.previousValue);
      } else {
        removeVisibleGlossaryTerm(intent.value.visibleTermId);
      }
      state.glossaryTermEditor = createGlossaryTermEditorModalState(draftSnapshot, {
        error: rollbackMessage,
        termId: draftSnapshot.termId,
      });
      render();
      throw new Error(rollbackMessage);
    }
    if (syncIssue?.message) {
      showGlossaryEditorStatus(render, "Rolling back glossary term save...");
      const rollbackMessage = await rollbackGlossaryTermSave(
        repoInput,
        previousHeadSha,
        syncIssue.message,
      );
      if (intent.previousValue) {
        markVisibleGlossaryTermConfirmed(intent.value.visibleTermId, intent.previousValue);
      } else {
        removeVisibleGlossaryTerm(intent.value.visibleTermId);
      }
      state.glossaryTermEditor = createGlossaryTermEditorModalState(draftSnapshot, {
        error: rollbackMessage,
        termId: draftSnapshot.termId,
      });
      render();
      throw new Error(rollbackMessage);
    }

    const confirmedTerm = upsertPayload?.term
      ? {
        ...upsertPayload.term,
        pendingMutation: null,
        pendingError: "",
        optimisticClientId: null,
      }
      : null;
    if (confirmedTerm) {
      markVisibleGlossaryTermConfirmed(intent.value.visibleTermId, confirmedTerm, {
        termCount: upsertPayload?.termCount,
      });
    } else if (intent.value.visibleTermId) {
      markVisibleGlossaryTermConfirmed(intent.value.visibleTermId, null, {
        termCount: upsertPayload?.termCount,
      });
    }
    markGlossaryBackgroundSyncDirty();
    clearGlossaryEditorStatus(render);
    showNoticeBadge(intent.value?.isCreate ? "Glossary term added." : "Glossary term saved.", render);
  } catch (error) {
    clearGlossaryEditorStatus(render);
    throw error;
  }
}

export async function openGlossaryTermEditor(render, termId = null) {
  const team = selectedTeam();
  const glossary = selectedGlossary();
  if (!canManageGlossaries()) {
    showNoticeBadge("You do not have permission to edit glossary terms in this team.", render);
    return;
  }
  if (await ensureGlossaryNotTombstoned(render, team, glossary)) {
    return;
  }

  const term = termId
    ? findGlossaryTermById(termId, state.glossaryEditor)
    : null;
  if (termId && !term) {
    resetGlossaryTermEditor();
    return;
  }

  state.glossaryTermEditor = createGlossaryTermEditorModalState(term);
  render();
}

export function cancelGlossaryTermEditor(render) {
  resetGlossaryTermEditor();
  render();
}

export function updateGlossaryTermDraftField(field, value) {
  if (!state.glossaryTermEditor?.isOpen) {
    return;
  }
  state.glossaryTermEditor[field] = value;
  if (state.glossaryTermEditor.error) {
    state.glossaryTermEditor.error = "";
  }
}

export function updateGlossaryTermVariant(side, index, value) {
  if (!Number.isInteger(index) || index < 0) {
    return;
  }

  updateGlossaryTermArray(side, (terms) =>
    terms.map((term, termIndex) => (termIndex === index ? String(value ?? "") : term)),
  );
  if (side === "source" && shouldRefreshGlossaryTermDuplicateFeedback()) {
    refreshGlossaryTermDuplicateFeedback();
  }
}

export function addGlossaryTermVariant(side) {
  updateGlossaryTermArray(side, (terms) => [...terms, ""]);
  if (side === "source" && shouldRefreshGlossaryTermDuplicateFeedback()) {
    refreshGlossaryTermDuplicateFeedback();
  }
}

export function addGlossaryTermEmptyTargetVariant() {
  updateGlossaryTermArray("target", (terms) => {
    if (terms.some((term) => term === GLOSSARY_EMPTY_TARGET_VARIANT_SENTINEL)) {
      return terms;
    }
    return [...terms, GLOSSARY_EMPTY_TARGET_VARIANT_SENTINEL];
  });
}

export function removeGlossaryTermVariant(side, index) {
  if (!Number.isInteger(index) || index < 0) {
    return;
  }

  updateGlossaryTermArray(side, (terms) => {
    if (terms.length <= 1) {
      return [""];
    }

    return terms.filter((_, termIndex) => termIndex !== index);
  });
  if (side === "source" && shouldRefreshGlossaryTermDuplicateFeedback()) {
    refreshGlossaryTermDuplicateFeedback();
  }
}

export function moveGlossaryTermVariantToIndex(side, fromIndex, toIndex) {
  if (
    !Number.isInteger(fromIndex)
    || fromIndex < 0
    || !Number.isInteger(toIndex)
    || toIndex < 0
  ) {
    return;
  }

  updateGlossaryTermArray(side, (terms) => {
    if (fromIndex >= terms.length) {
      return terms;
    }

    const boundedIndex = Math.min(toIndex, terms.length);
    const adjustedIndex = boundedIndex > fromIndex ? boundedIndex - 1 : boundedIndex;
    if (adjustedIndex === fromIndex) {
      return terms;
    }

    const nextTerms = [...terms];
    const [movedTerm] = nextTerms.splice(fromIndex, 1);
    nextTerms.splice(Math.min(adjustedIndex, nextTerms.length), 0, movedTerm);
    return nextTerms;
  });
  if (side === "source" && shouldRefreshGlossaryTermDuplicateFeedback()) {
    refreshGlossaryTermDuplicateFeedback();
  }
}

export async function submitGlossaryTermEditor(render) {
  const team = selectedTeam();
  const repoName = selectedGlossaryRepoName();
  const glossary = selectedGlossary();
  const draft = state.glossaryTermEditor;
  if (!draft?.isOpen || !Number.isFinite(team?.installationId) || !repoName) {
    return;
  }

  if (!canManageGlossaries(team)) {
    state.glossaryTermEditor.error = "You do not have permission to edit glossary terms in this team.";
    render();
    return;
  }
  if (await ensureGlossaryNotTombstoned(render, team, glossary)) {
    resetGlossaryTermEditor();
    render();
    return;
  }

  const sourceTerms = sanitizeEditableTerms(draft.sourceTerms);
  if (sourceTerms.length === 0) {
    state.glossaryTermEditor.error = "Enter at least one source term.";
    render();
    return;
  }
  if (refreshGlossaryTermDuplicateFeedback({ activateWarning: true })) {
    state.glossaryTermEditor.error = "";
    render();
    return;
  }

  const targetTerms = sanitizeEditableTargetTerms(draft.targetTerms);
  const draftSnapshot = {
    termId: draft.termId || null,
    sourceTerms: [...sourceTerms],
    targetTerms: [...targetTerms],
    notesToTranslators: draft.notesToTranslators,
    footnote: draft.footnote,
    untranslated: draft.untranslated === true,
  };
  const repoInput = {
    installationId: team.installationId,
    glossaryId: glossary?.id ?? null,
    repoName,
  };
  const isCreate = !draftSnapshot.termId;
  const visibleTermId = draftSnapshot.termId || nextOptimisticClientTermId();
  const previousValue = draftSnapshot.termId
    ? findGlossaryTermById(draftSnapshot.termId, state.glossaryEditor)
    : null;
  const optimisticTerm = buildGlossaryTermFromDraft(draftSnapshot, {
    termId: visibleTermId,
    optimisticClientId: isCreate ? visibleTermId : null,
    pendingMutation: isCreate ? "create" : "save",
  });
  upsertVisibleGlossaryTerm(optimisticTerm);
  resetGlossaryTermEditor();
  render();

  requestGlossaryTermWriteIntent({
    key: glossaryTermSaveIntentKey(repoInput.glossaryId, visibleTermId),
    scope: glossaryTermWriteScope(team, repoName),
    teamId: team.id,
    glossaryId: repoInput.glossaryId,
    repoName,
    type: "glossaryTermSave",
    previousValue,
    value: {
      draftSnapshot,
      repoInput,
      visibleTermId,
      isCreate,
    },
  }, {
    clearOnSuccess: true,
    run: (intent) => runGlossaryTermSaveIntent(render, intent),
    onSuccess: () => {
      render();
    },
    onError: (error, intent) => {
      clearGlossaryEditorStatus(render);
      const errorMessage = error?.message ?? String(error);
      if (state.glossaryTermEditor?.isOpen && state.glossaryTermEditor.notice) {
        render();
        return;
      }
      restoreFailedGlossaryTermSave(render, intent, errorMessage);
    },
  });
}
