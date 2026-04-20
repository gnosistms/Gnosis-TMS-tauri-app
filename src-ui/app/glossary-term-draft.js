import { invoke } from "./runtime.js";
import { resetGlossaryTermEditor, state } from "./state.js";
import {
  markGlossaryBackgroundSyncDirty,
  maybeStartGlossaryBackgroundSync,
} from "./glossary-background-sync.js";
import { loadSelectedGlossaryEditorData } from "./glossary-editor-flow.js";
import { showNoticeBadge } from "./status-feedback.js";
import {
  canManageGlossaries,
  normalizeEditableTerms,
  sanitizeEditableTargetTerms,
  sanitizeEditableTerms,
  selectedGlossary,
  selectedGlossaryRepoName,
  selectedTeam,
  updateGlossaryTermArray,
} from "./glossary-shared.js";
import {
  ensureGlossaryNotTombstoned,
  getGlossarySyncIssueMessage,
  syncSingleGlossaryForTeam,
} from "./glossary-repo-flow.js";
import { ensureGlossaryTermReadyForEdit } from "./glossary-term-sync.js";

const SOURCE_TERM_DUPLICATE_WARNING =
  "The terms highlighted in red below are redundant with other parts of this glossary. Please remove them before saving.";

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
      const normalized = String(sourceTerm ?? "").trim();
      if (normalized) {
        existingTerms.add(normalized);
      }
    }
  }

  for (const sourceTerm of candidateTerms) {
    const normalized = String(sourceTerm ?? "").trim();
    if (!normalized) {
      continue;
    }

    candidateCounts.set(normalized, (candidateCounts.get(normalized) ?? 0) + 1);
  }

  return candidateTerms.reduce((indices, sourceTerm, index) => {
    const normalized = String(sourceTerm ?? "").trim();
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

  if (termId) {
    await maybeStartGlossaryBackgroundSync(render, { force: true });
  }

  const term = termId
    ? await ensureGlossaryTermReadyForEdit(render, termId)
    : null;
  if (termId && !term) {
    return;
  }

  state.glossaryTermEditor = {
    ...state.glossaryTermEditor,
    isOpen: true,
    status: "idle",
    error: "",
    glossaryId: state.glossaryEditor.glossaryId,
    termId: term?.termId ?? null,
    sourceTerms: normalizeEditableTerms(term?.sourceTerms ?? []),
    targetTerms: normalizeEditableTerms(term?.targetTerms ?? []),
    sourceTermDuplicateWarning: "",
    redundantSourceVariantIndices: [],
    notesToTranslators: term?.notesToTranslators ?? "",
    footnote: term?.footnote ?? "",
    untranslated: term?.untranslated === true,
  };
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

  state.glossaryTermEditor.status = "loading";
  state.glossaryTermEditor.error = "";
  render();

  try {
    await maybeStartGlossaryBackgroundSync(render, { force: true });
    await invoke("upsert_gtms_glossary_term", {
      input: {
        installationId: team.installationId,
        glossaryId: glossary?.id ?? null,
        repoName,
        termId: draftSnapshot.termId,
        sourceTerms: draftSnapshot.sourceTerms,
        targetTerms: draftSnapshot.targetTerms,
        notesToTranslators: draftSnapshot.notesToTranslators,
        footnote: draftSnapshot.footnote,
        untranslated: draftSnapshot.untranslated,
      },
    });
    const syncIssue = getGlossarySyncIssueMessage(
      await syncSingleGlossaryForTeam(team, selectedGlossary()),
    );
    markGlossaryBackgroundSyncDirty();
    resetGlossaryTermEditor();
    await loadSelectedGlossaryEditorData(render);
    if (syncIssue?.message) {
      showNoticeBadge(syncIssue.message, render);
    }
  } catch (error) {
    state.glossaryTermEditor.status = "idle";
    const errorMessage = error?.message ?? String(error);
    if (errorMessage === SOURCE_TERM_DUPLICATE_WARNING) {
      if (!refreshGlossaryTermDuplicateFeedback({ activateWarning: true })) {
        state.glossaryTermEditor.error = errorMessage;
      } else {
        state.glossaryTermEditor.error = "";
      }
    } else {
      state.glossaryTermEditor.error = errorMessage;
    }
    render();
  }
}
