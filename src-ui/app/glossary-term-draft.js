import { invoke } from "./runtime.js";
import { requireBrokerSession } from "./auth-flow.js";
import {
  createGlossaryTermEditorState,
  resetGlossaryTermEditor,
  state,
} from "./state.js";
import { markGlossaryBackgroundSyncDirty } from "./glossary-background-sync.js";
import { clearScopedSyncBadge, showNoticeBadge, showScopedSyncBadge } from "./status-feedback.js";
import {
  GLOSSARY_EMPTY_TARGET_VARIANT_SENTINEL,
  canManageGlossaries,
  normalizeEditableTerms,
  normalizeEditableTargetVariantNotes,
  normalizeEditableTargetTerms,
  sanitizeEditableTargetTermPairs,
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
  glossaryRepoDescriptor,
  syncSingleGlossaryForTeam,
} from "./glossary-repo-flow.js";
import { getGlossaryWritePolicy } from "./resource-write-policy.js";
import {
  buildGlossaryTermFromDraft,
  ensureGlossaryTermReadyForEdit,
  findGlossaryTermById,
  markGlossaryTermsStale,
  markVisibleGlossaryTermConfirmed,
  markVisibleGlossaryTermFailed,
  removeVisibleGlossaryTerm,
  upsertVisibleGlossaryTerm,
} from "./glossary-term-sync.js";
import {
  clearFailedGlossaryTermWrite,
  failedGlossaryTermWrites,
  getGlossaryTermWriteIntent,
  glossaryTermSaveIntentKey,
  glossaryTermWriteScope,
  requestGlossaryTermWriteIntent,
} from "./glossary-term-write-coordinator.js";
import { removeGlossaryEditorQuery } from "./glossary-editor-query.js";

const SOURCE_TERM_DUPLICATE_WARNING =
  "Some source variants are duplicated within this term or elsewhere in the glossary. Remove or change the marked variants before saving.";
const SOURCE_TERM_CONFLICT_PREFIX = "Remove or change these duplicate source variants before saving: ";
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
  const existingTerms = new Set(
    (state.glossaryTermEditor?.conflictingSourceTerms ?? []).map(normalizeSourceTermForDuplicateDetection),
  );

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
      element.setAttribute("aria-invalid", String(Number.isInteger(index) && redundantIndices.has(index)));
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
  const targetTerms = normalizeEditableTargetTerms(term?.targetTerms ?? []);
  return {
    ...createGlossaryTermEditorState(),
    isOpen: true,
    status: overrides.status ?? "idle",
    error: overrides.error ?? "",
    notice: overrides.notice ?? "",
    glossaryId: overrides.glossaryId ?? state.glossaryEditor?.glossaryId ?? null,
    teamId: state.selectedTeamId,
    installationId: selectedTeam()?.installationId ?? null,
    repoName: state.glossaryEditor?.repoName ?? "",
    failedIntentKey: overrides.failedIntentKey ?? null,
    termId: overrides.termId ?? term?.termId ?? null,
    sourceTerms: normalizeEditableTerms(term?.sourceTerms ?? []),
    targetTerms,
    targetVariantNotes: normalizeEditableTargetVariantNotes(
      targetTerms,
      term?.targetVariantNotes ?? [],
    ),
    sourceTermDuplicateWarning: "",
    redundantSourceVariantIndices: [],
    conflictingSourceTerms: [],
    notesToTranslators: term?.notesToTranslators ?? "",
    footnote: term?.footnote ?? "",
    untranslated: term?.untranslated === true,
    attemptedDraft: overrides.attemptedDraft ?? null,
  };
}

async function reopenGlossaryTermEditorWithLatestRemote(render, termId, intent) {
  const latestTerm = await ensureGlossaryTermReadyForEdit(render, termId, {
    suppressNotice: true,
  });
  if (!glossarySaveContextMatches(intent) || state.screen !== "glossaryEditor") return false;
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

export async function rollbackGlossaryTermSave(repoInput, previousHeadSha, failureMessage) {
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

function glossarySaveContextMatches(intent) {
  const input = intent.value?.repoInput;
  return state.selectedTeamId === intent.teamId
    && selectedTeam()?.installationId === input?.installationId
    && state.glossaryEditor?.glossaryId === input?.glossaryId
    && state.glossaryEditor?.repoName === input?.repoName;
}

function restoreFailedGlossaryTermSave(render, intent, message) {
  if (!glossarySaveContextMatches(intent) || state.glossaryEditor?.status !== "ready") return;
  const draftSnapshot = intent.value?.draftSnapshot ?? null;
  const visibleTermId = intent.value?.visibleTermId ?? draftSnapshot?.termId ?? null;
  if (intent.value?.isCreate) {
    removeVisibleGlossaryTerm(visibleTermId);
  } else if (intent.previousValue && message !== GLOSSARY_TERM_REMOTE_UPDATE_NOTICE) {
    markVisibleGlossaryTermConfirmed(visibleTermId, intent.previousValue);
  } else if (visibleTermId) {
    markVisibleGlossaryTermFailed(visibleTermId, message);
  }
  if (state.screen !== "glossaryEditor" || state.glossaryTermEditor?.isOpen) return;

  const remoteConflict = message === GLOSSARY_TERM_REMOTE_UPDATE_NOTICE;
  const term = remoteConflict ? findGlossaryTermById(draftSnapshot?.termId) : draftSnapshot;
  if (remoteConflict && !term) {
    showNoticeBadge("The term was deleted on GitHub.", render);
    clearFailedGlossaryTermWrite(intent.key);
    return;
  }
  state.glossaryTermEditor = createGlossaryTermEditorModalState(term, {
    glossaryId: intent.glossaryId,
    failedIntentKey: intent.key,
    error: remoteConflict ? "" : message,
    notice: remoteConflict ? GLOSSARY_TERM_REMOTE_UPDATE_NOTICE : "",
    attemptedDraft: remoteConflict ? draftSnapshot : null,
    termId: draftSnapshot?.termId ?? null,
  });
  if (message.startsWith(SOURCE_TERM_CONFLICT_PREFIX)) {
    try {
      const conflicts = JSON.parse(message.slice(SOURCE_TERM_CONFLICT_PREFIX.length));
      if (Array.isArray(conflicts) && conflicts.every(value => typeof value === "string")) {
        state.glossaryTermEditor.conflictingSourceTerms = conflicts;
        if (refreshGlossaryTermDuplicateFeedback({ activateWarning: true })) {
          state.glossaryTermEditor.error = "";
        }
      }
    } catch {
      // Preserve the readable backend error if its details cannot be decoded.
    }
  } else if (message === "The terms highlighted in red below are redundant with other parts of this glossary. Please remove them before saving.") {
    // A running native backend can predate the frontend during development.
    state.glossaryTermEditor.error = refreshGlossaryTermDuplicateFeedback({ activateWarning: true })
      ? ""
      : "Some source variants already exist in this glossary. Refresh the glossary to identify them, then remove or change them before saving.";
  }
  render();
}

export function restorePendingGlossaryTermDraft(render) {
  const editor = state.glossaryEditor;
  const intent = failedGlossaryTermWrites(selectedTeam(), editor?.glossaryId, editor?.repoName)[0];
  if (intent) restoreFailedGlossaryTermSave(render, intent, intent.error);
}

async function runGlossaryTermSaveIntent(render, intent) {
  try {
    const team = intent.value?.team;
    const glossary = intent.value?.glossary;
    const draftSnapshot = intent.value?.draftSnapshot;
    const repoInput = intent.value?.repoInput;
    if (!draftSnapshot || !repoInput || !Number.isFinite(team?.installationId)) {
      throw new Error("Could not determine which glossary term to save.");
    }

    const descriptor = glossaryRepoDescriptor(glossary);
    if (!descriptor) {
      throw new Error("Could not determine the glossary repository. Reopen the glossary and try again.");
    }
    let previousHeadSha = null;
    showGlossaryEditorStatus(render, "Checking remote glossary changes...");
    const syncResult = await invoke("sync_gtms_glossary_editor_repo", {
      input: { installationId: team.installationId, ...descriptor },
      sessionToken: requireBrokerSession(),
    });
    if (glossarySaveContextMatches(intent)) markGlossaryTermsStale(syncResult ?? {});
    const remotelyChanged = [...(syncResult?.changedTermIds ?? []), ...(syncResult?.deletedTermIds ?? [])]
      .includes(draftSnapshot.termId);
    if (draftSnapshot.termId) {
      const currentTerm = glossarySaveContextMatches(intent)
        ? findGlossaryTermById(draftSnapshot.termId, state.glossaryEditor) : null;
      if (remotelyChanged || currentTerm?.freshness === "stale" || currentTerm?.remotelyDeleted === true) {
        if (glossarySaveContextMatches(intent) && state.screen === "glossaryEditor") {
          markVisibleGlossaryTermFailed(draftSnapshot.termId, GLOSSARY_TERM_REMOTE_UPDATE_NOTICE);
          const reopened = await reopenGlossaryTermEditorWithLatestRemote(render, draftSnapshot.termId, intent);
          if (reopened) {
            state.glossaryTermEditor.attemptedDraft = draftSnapshot;
            state.glossaryTermEditor.failedIntentKey = intent.key;
          }
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
        targetVariantNotes: draftSnapshot.targetVariantNotes,
        notesToTranslators: draftSnapshot.notesToTranslators,
        footnote: draftSnapshot.footnote,
        untranslated: draftSnapshot.untranslated,
      },
    });
    previousHeadSha = upsertPayload?.previousHeadSha ?? null;
    try {
      showGlossaryEditorStatus(render, "Syncing glossary repo...");
      const syncIssue = getGlossarySyncIssueMessage(await syncSingleGlossaryForTeam(team, glossary));
      if (syncIssue?.message) throw new Error(syncIssue.message);
    } catch (error) {
      showGlossaryEditorStatus(render, "Rolling back glossary term save...");
      const rollbackMessage = await rollbackGlossaryTermSave(repoInput, previousHeadSha, error?.message ?? String(error));
      if (glossarySaveContextMatches(intent)) {
        if (intent.previousValue) {
          markVisibleGlossaryTermConfirmed(intent.value.visibleTermId, intent.previousValue);
        } else {
          removeVisibleGlossaryTerm(intent.value.visibleTermId);
        }
      }
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
    if (glossarySaveContextMatches(intent)) {
      if (confirmedTerm) {
        markVisibleGlossaryTermConfirmed(intent.value.visibleTermId, confirmedTerm, {
          termCount: upsertPayload?.termCount,
        });
      } else if (intent.value.visibleTermId) {
        markVisibleGlossaryTermConfirmed(intent.value.visibleTermId, null, {
          termCount: upsertPayload?.termCount,
        });
      }
      if (state.glossaryEditor.status === "ready") markGlossaryBackgroundSyncDirty();
    }
    clearGlossaryEditorStatus(render);
    showNoticeBadge(intent.value?.isCreate ? "Glossary term added." : "Glossary term saved.", render);
  } catch (error) {
    clearGlossaryEditorStatus(render);
    throw error;
  } finally {
    removeGlossaryEditorQuery(intent.value?.team, intent.value?.glossary);
  }
}

export async function openGlossaryTermEditor(render, termId = null) {
  const team = selectedTeam();
  const glossary = selectedGlossary();
  const editor = state.glossaryEditor;
  if (!canManageGlossaries()) {
    showNoticeBadge("You do not have permission to edit glossary terms in this team.", render);
    return;
  }
  const policy = getGlossaryWritePolicy({ team, glossary });
  if (!policy.allowed) {
    showNoticeBadge(policy.message, render);
    return;
  }
  if (await ensureGlossaryNotTombstoned(render, team, glossary)) {
    return;
  }
  if (state.selectedTeamId !== team?.id
    || state.screen !== "glossaryEditor"
    || state.glossaryEditor?.glossaryId !== editor?.glossaryId
    || state.glossaryEditor?.repoName !== editor?.repoName) return;

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
  const key = state.glossaryTermEditor?.failedIntentKey;
  const intent = key ? getGlossaryTermWriteIntent(key) : null;
  if (intent && glossarySaveContextMatches(intent)) {
    if (intent.error === GLOSSARY_TERM_REMOTE_UPDATE_NOTICE) {
      markVisibleGlossaryTermConfirmed(intent.value.visibleTermId, null);
    } else if (intent.previousValue) {
      markVisibleGlossaryTermConfirmed(intent.value.visibleTermId, intent.previousValue);
    } else {
      removeVisibleGlossaryTerm(intent.value.visibleTermId);
    }
  }
  if (key) clearFailedGlossaryTermWrite(key);
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

export function updateGlossaryTermVariantNote(index, value) {
  if (!state.glossaryTermEditor?.isOpen || !Number.isInteger(index) || index < 0) {
    return;
  }

  const targetTerms = normalizeEditableTerms(state.glossaryTermEditor.targetTerms);
  const targetVariantNotes = normalizeEditableTargetVariantNotes(
    targetTerms,
    state.glossaryTermEditor.targetVariantNotes,
  );
  state.glossaryTermEditor.targetVariantNotes = targetTerms.map((_, termIndex) =>
    termIndex === index ? String(value ?? "") : targetVariantNotes[termIndex] ?? "",
  );
  if (state.glossaryTermEditor.error) {
    state.glossaryTermEditor.error = "";
  }
}

export function addGlossaryTermVariant(side) {
  if (side === "target" && state.glossaryTermEditor?.isOpen) {
    const targetTerms = normalizeEditableTerms(state.glossaryTermEditor.targetTerms);
    state.glossaryTermEditor.targetTerms = [...targetTerms, ""];
    state.glossaryTermEditor.targetVariantNotes = [
      ...normalizeEditableTargetVariantNotes(
        targetTerms,
        state.glossaryTermEditor.targetVariantNotes,
      ),
      "",
    ];
    if (state.glossaryTermEditor.error) {
      state.glossaryTermEditor.error = "";
    }
    return;
  }

  updateGlossaryTermArray(side, (terms) => [...terms, ""]);
  if (side === "source" && shouldRefreshGlossaryTermDuplicateFeedback()) {
    refreshGlossaryTermDuplicateFeedback();
  }
}

export function addGlossaryTermEmptyTargetVariant() {
  if (!state.glossaryTermEditor?.isOpen) {
    return;
  }

  const targetTerms = normalizeEditableTerms(state.glossaryTermEditor.targetTerms);
  if (targetTerms.some((term) => term === GLOSSARY_EMPTY_TARGET_VARIANT_SENTINEL)) {
    return;
  }
  state.glossaryTermEditor.targetTerms = [...targetTerms, GLOSSARY_EMPTY_TARGET_VARIANT_SENTINEL];
  state.glossaryTermEditor.targetVariantNotes = [
    ...normalizeEditableTargetVariantNotes(targetTerms, state.glossaryTermEditor.targetVariantNotes),
    "",
  ];
  if (state.glossaryTermEditor.error) {
    state.glossaryTermEditor.error = "";
  }
}

export function removeGlossaryTermVariant(side, index) {
  if (!Number.isInteger(index) || index < 0) {
    return;
  }

  if (side === "target" && state.glossaryTermEditor?.isOpen) {
    const targetTerms = normalizeEditableTerms(state.glossaryTermEditor.targetTerms);
    const targetVariantNotes = normalizeEditableTargetVariantNotes(
      targetTerms,
      state.glossaryTermEditor.targetVariantNotes,
    );
    if (targetTerms.length <= 1) {
      state.glossaryTermEditor.targetTerms = [""];
      state.glossaryTermEditor.targetVariantNotes = [""];
    } else {
      state.glossaryTermEditor.targetTerms = targetTerms.filter((_, termIndex) => termIndex !== index);
      state.glossaryTermEditor.targetVariantNotes = targetVariantNotes.filter((_, termIndex) => termIndex !== index);
    }
    if (state.glossaryTermEditor.error) {
      state.glossaryTermEditor.error = "";
    }
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

  if (side === "target" && state.glossaryTermEditor?.isOpen) {
    const targetTerms = normalizeEditableTerms(state.glossaryTermEditor.targetTerms);
    const targetVariantNotes = normalizeEditableTargetVariantNotes(
      targetTerms,
      state.glossaryTermEditor.targetVariantNotes,
    );
    if (fromIndex >= targetTerms.length) {
      return;
    }

    const boundedIndex = Math.min(toIndex, targetTerms.length);
    const adjustedIndex = boundedIndex > fromIndex ? boundedIndex - 1 : boundedIndex;
    if (adjustedIndex === fromIndex) {
      return;
    }

    const nextTerms = [...targetTerms];
    const nextNotes = [...targetVariantNotes];
    const [movedTerm] = nextTerms.splice(fromIndex, 1);
    const [movedNote] = nextNotes.splice(fromIndex, 1);
    const insertionIndex = Math.min(adjustedIndex, nextTerms.length);
    nextTerms.splice(insertionIndex, 0, movedTerm);
    nextNotes.splice(insertionIndex, 0, movedNote);
    state.glossaryTermEditor.targetTerms = nextTerms;
    state.glossaryTermEditor.targetVariantNotes = nextNotes;
    if (state.glossaryTermEditor.error) {
      state.glossaryTermEditor.error = "";
    }
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

export function resolveGlossaryTermWriteRepo() {
  // Collection refreshes can leave an incomplete summary while the editor stays open.
  // Capture the repo identity now so queued saves never depend on later navigation.
  const editor = state.glossaryEditor;
  const summary = selectedGlossary();
  const repoName = selectedGlossaryRepoName();
  if (!editor?.glossaryId || !repoName) {
    throw new Error("Could not determine the glossary repository. Reopen the glossary and try again.");
  }
  const fullName = summary?.fullName || editor.fullName || "";
  if ((summary && summary.id !== editor.glossaryId)
    || (summary?.repoName && summary.repoName !== repoName)
    || (summary?.fullName && editor.fullName && summary.fullName !== editor.fullName)
    || (Number.isFinite(summary?.repoId) && Number.isFinite(editor.repoId)
      && summary.repoId !== editor.repoId)
    || (fullName && (fullName.split("/").length !== 2 || fullName.split("/")[1] !== repoName))) {
    throw new Error("The glossary repository details have changed. Reopen the glossary before making changes.");
  }
  const glossary = {
    ...summary,
    id: editor.glossaryId,
    repoName,
    fullName,
    repoId: summary?.repoId ?? editor.repoId,
    defaultBranchName: summary?.defaultBranchName || editor.defaultBranchName,
    defaultBranchHeadOid: summary?.defaultBranchHeadOid ?? editor.defaultBranchHeadOid,
    lifecycleState: summary?.lifecycleState ?? editor.lifecycleState,
    recordState: summary?.recordState ?? editor.recordState,
    remoteState: summary?.remoteState ?? editor.remoteState,
  };
  if (!glossaryRepoDescriptor(glossary)) {
    throw new Error("Could not determine the glossary repository. Reopen the glossary and try again.");
  }
  return glossary;
}

export async function submitGlossaryTermEditor(render) {
  const team = selectedTeam();
  const repoName = selectedGlossaryRepoName();
  const draft = state.glossaryTermEditor;
  if (!draft?.isOpen || !Number.isFinite(team?.installationId) || !repoName
    || draft.glossaryId !== state.glossaryEditor?.glossaryId
    || (draft.teamId != null && draft.teamId !== team.id)
    || (draft.installationId != null && draft.installationId !== team.installationId)
    || (draft.repoName && draft.repoName !== repoName)) {
    return;
  }

  let glossary;
  try {
    glossary = resolveGlossaryTermWriteRepo();
  } catch (error) {
    state.glossaryTermEditor.error = error.message;
    render();
    return;
  }

  if (!canManageGlossaries(team)) {
    state.glossaryTermEditor.error = "You do not have permission to edit glossary terms in this team.";
    render();
    return;
  }
  const policy = getGlossaryWritePolicy({ team, glossary });
  if (!policy.allowed) {
    state.glossaryTermEditor.error = policy.message;
    render();
    return;
  }
  if (await ensureGlossaryNotTombstoned(render, team, glossary)) {
    resetGlossaryTermEditor();
    render();
    return;
  }

  if (state.glossaryTermEditor !== draft || selectedTeam()?.id !== team.id
    || state.glossaryEditor?.glossaryId !== draft.glossaryId
    || state.glossaryEditor?.repoName !== repoName) return;

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

  const { targetTerms, targetVariantNotes } = sanitizeEditableTargetTermPairs(
    draft.targetTerms,
    draft.targetVariantNotes,
  );
  const draftSnapshot = {
    termId: draft.termId || null,
    sourceTerms: [...sourceTerms],
    targetTerms: [...targetTerms],
    targetVariantNotes: [...targetVariantNotes],
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
  removeGlossaryEditorQuery(team, glossary);
  if (draft.failedIntentKey) clearFailedGlossaryTermWrite(draft.failedIntentKey);
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
      team: { ...team },
      glossary: { ...glossary },
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
      if (glossarySaveContextMatches(intent) && state.glossaryTermEditor?.isOpen && state.glossaryTermEditor.notice) {
        render();
        return;
      }
      restoreFailedGlossaryTermSave(render, intent, errorMessage);
      if (!glossarySaveContextMatches(intent)) {
        showNoticeBadge(`Could not save a term in ${intent.value?.glossary?.title || "the glossary"}. Reopen that glossary to retry.`, render);
      }
    },
  });
}
