import { normalizeGlossaryTerm, selectedGlossaryRepoName, selectedTeam } from "./glossary-shared.js";
import { state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";

const pendingGlossaryTermReloads = new Map();

export function findGlossaryTermById(termId, glossaryState = state.glossaryEditor) {
  if (!termId || !Array.isArray(glossaryState?.terms)) {
    return null;
  }

  return glossaryState.terms.find((term) => term?.termId === termId) ?? null;
}

function glossaryTermUiFields(term = {}) {
  return {
    pendingMutation:
      term.pendingMutation === "save" || term.pendingMutation === "create"
        ? term.pendingMutation
        : null,
    pendingError: typeof term.pendingError === "string" ? term.pendingError : "",
    optimisticClientId:
      typeof term.optimisticClientId === "string" && term.optimisticClientId.trim()
        ? term.optimisticClientId.trim()
        : null,
  };
}

function withGlossaryTermUiFields(term, uiFields = {}) {
  if (!term) {
    return null;
  }

  return {
    ...term,
    pendingMutation:
      uiFields.pendingMutation === "save" || uiFields.pendingMutation === "create"
        ? uiFields.pendingMutation
        : null,
    pendingError: typeof uiFields.pendingError === "string" ? uiFields.pendingError : "",
    optimisticClientId:
      typeof uiFields.optimisticClientId === "string" && uiFields.optimisticClientId.trim()
        ? uiFields.optimisticClientId.trim()
        : null,
  };
}

function normalizedVisibleGlossaryTerm(term, uiFields = {}) {
  const normalized = normalizeGlossaryTerm(term);
  return normalized ? withGlossaryTermUiFields(normalized, uiFields) : null;
}

function updateGlossarySummaryTermCount(glossaryId, repoName, termCount) {
  if (!Number.isFinite(termCount)) {
    return;
  }

  state.glossaries = (Array.isArray(state.glossaries) ? state.glossaries : []).map((glossary) => {
    if (glossary?.id !== glossaryId && glossary?.repoName !== repoName) {
      return glossary;
    }
    return {
      ...glossary,
      termCount,
    };
  });
}

function setGlossaryEditorTerms(terms, options = {}) {
  if (!state.glossaryEditor?.glossaryId) {
    return false;
  }

  const termCount = Number.isFinite(options.termCount) ? options.termCount : terms.length;
  state.glossaryEditor = {
    ...state.glossaryEditor,
    terms,
    termCount,
  };
  updateGlossarySummaryTermCount(
    state.glossaryEditor.glossaryId,
    state.glossaryEditor.repoName,
    termCount,
  );
  return true;
}

function updateGlossaryEditorTerm(termId, updater) {
  if (!state.glossaryEditor?.glossaryId || !Array.isArray(state.glossaryEditor.terms)) {
    return null;
  }

  let updatedTerm = null;
  const terms = state.glossaryEditor.terms.map((term) => {
    if (!term || term.termId !== termId) {
      return term;
    }

    updatedTerm = updater(term);
    return updatedTerm;
  });
  if (!updatedTerm) {
    return null;
  }

  setGlossaryEditorTerms(terms, { termCount: state.glossaryEditor.termCount });
  return updatedTerm;
}

export function buildGlossaryTermFromDraft(draftSnapshot, options = {}) {
  const termId =
    typeof options.termId === "string" && options.termId.trim()
      ? options.termId.trim()
      : typeof draftSnapshot?.termId === "string" && draftSnapshot.termId.trim()
        ? draftSnapshot.termId.trim()
        : typeof options.optimisticClientId === "string" && options.optimisticClientId.trim()
          ? options.optimisticClientId.trim()
          : null;
  if (!termId) {
    return null;
  }

  return normalizedVisibleGlossaryTerm(
    {
      termId,
      sourceTerms: Array.isArray(draftSnapshot?.sourceTerms) ? draftSnapshot.sourceTerms : [],
      targetTerms: Array.isArray(draftSnapshot?.targetTerms) ? draftSnapshot.targetTerms : [],
      notesToTranslators:
        typeof draftSnapshot?.notesToTranslators === "string"
          ? draftSnapshot.notesToTranslators
          : "",
      footnote: typeof draftSnapshot?.footnote === "string" ? draftSnapshot.footnote : "",
      untranslated: draftSnapshot?.untranslated === true,
      lifecycleState: "active",
    },
    {
      pendingMutation: options.pendingMutation ?? null,
      pendingError: options.pendingError ?? "",
      optimisticClientId: options.optimisticClientId ?? null,
    },
  );
}

export function upsertVisibleGlossaryTerm(term, options = {}) {
  if (!state.glossaryEditor?.glossaryId || !Array.isArray(state.glossaryEditor.terms)) {
    return null;
  }

  const normalized = normalizedVisibleGlossaryTerm(term, {
    ...glossaryTermUiFields(term),
    pendingMutation: options.pendingMutation ?? term?.pendingMutation ?? null,
    pendingError: options.pendingError ?? term?.pendingError ?? "",
    optimisticClientId: options.optimisticClientId ?? term?.optimisticClientId ?? null,
  });
  if (!normalized) {
    return null;
  }

  let matched = false;
  const terms = state.glossaryEditor.terms.map((currentTerm) => {
    if (currentTerm?.termId !== normalized.termId) {
      return currentTerm;
    }
    matched = true;
    return normalized;
  });
  if (!matched) {
    terms.push(normalized);
  }

  const currentTermCount = Number.isFinite(state.glossaryEditor.termCount)
    ? state.glossaryEditor.termCount
    : state.glossaryEditor.terms.length;
  setGlossaryEditorTerms(terms, {
    termCount: matched ? currentTermCount : currentTermCount + 1,
  });
  return normalized;
}

export function replaceOptimisticGlossaryTerm(clientId, confirmedTerm, options = {}) {
  if (
    !clientId
    || !state.glossaryEditor?.glossaryId
    || !Array.isArray(state.glossaryEditor.terms)
  ) {
    return null;
  }

  const normalized = normalizedVisibleGlossaryTerm(confirmedTerm);
  if (!normalized) {
    return null;
  }

  let replaced = false;
  const terms = [];
  for (const term of state.glossaryEditor.terms) {
    if (term?.termId === clientId || term?.optimisticClientId === clientId) {
      if (!replaced) {
        terms.push(normalized);
        replaced = true;
      }
      continue;
    }
    if (term?.termId === normalized.termId) {
      if (!replaced) {
        terms.push(normalized);
        replaced = true;
      }
      continue;
    }
    terms.push(term);
  }

  if (!replaced) {
    terms.push(normalized);
  }

  setGlossaryEditorTerms(terms, {
    termCount: Number.isFinite(options.termCount)
      ? options.termCount
      : state.glossaryEditor.termCount,
  });
  return normalized;
}

export function markVisibleGlossaryTermPending(termId, mutation) {
  return updateGlossaryEditorTerm(termId, (term) =>
    withGlossaryTermUiFields(term, {
      ...glossaryTermUiFields(term),
      pendingMutation: mutation,
      pendingError: "",
    }),
  );
}

export function markVisibleGlossaryTermConfirmed(termId, confirmedTerm, options = {}) {
  const existingTerm = findGlossaryTermById(termId);
  const confirmed = normalizedVisibleGlossaryTerm(confirmedTerm ?? existingTerm);
  if (!confirmed) {
    return null;
  }

  if (termId && termId !== confirmed.termId) {
    return replaceOptimisticGlossaryTerm(termId, confirmed, options);
  }

  const updated = updateGlossaryEditorTerm(termId, () => confirmed) ?? upsertVisibleGlossaryTerm(confirmed);
  if (updated && Number.isFinite(options.termCount) && state.glossaryEditor?.glossaryId) {
    setGlossaryEditorTerms(state.glossaryEditor.terms, { termCount: options.termCount });
  }
  return updated;
}

export function markVisibleGlossaryTermFailed(termId, message) {
  return updateGlossaryEditorTerm(termId, (term) =>
    withGlossaryTermUiFields(term, {
      ...glossaryTermUiFields(term),
      pendingMutation: null,
      pendingError: typeof message === "string" ? message : String(message ?? ""),
    }),
  );
}

export function removeVisibleGlossaryTerm(termId) {
  if (!state.glossaryEditor?.glossaryId || !Array.isArray(state.glossaryEditor.terms)) {
    return;
  }

  const terms = state.glossaryEditor.terms.filter((term) => term?.termId !== termId);
  setGlossaryEditorTerms(terms, { termCount: terms.length });
}

export function applyGlossaryTermsStale(terms, syncResult = {}) {
  const changedTermIds = new Set(
    (Array.isArray(syncResult.changedTermIds) ? syncResult.changedTermIds : []).filter(Boolean),
  );
  const deletedTermIds = new Set(
    (Array.isArray(syncResult.deletedTermIds) ? syncResult.deletedTermIds : []).filter(Boolean),
  );

  return (Array.isArray(terms) ? terms : []).map((term) => {
    if (!term?.termId || (!changedTermIds.has(term.termId) && !deletedTermIds.has(term.termId))) {
      return term;
    }

    return {
      ...term,
      freshness: "stale",
      remotelyDeleted: term.remotelyDeleted === true || deletedTermIds.has(term.termId),
    };
  });
}

export function markGlossaryTermsStale(syncResult = {}) {
  if (!state.glossaryEditor?.glossaryId || !Array.isArray(state.glossaryEditor.terms)) {
    return;
  }

  state.glossaryEditor = {
    ...state.glossaryEditor,
    terms: applyGlossaryTermsStale(state.glossaryEditor.terms, syncResult),
  };
}

export async function loadGlossaryTermFromDisk(render, termId, options = {}) {
  if (!termId || !state.glossaryEditor?.glossaryId) {
    return null;
  }

  const glossaryId = state.glossaryEditor.glossaryId;
  const repoName = selectedGlossaryRepoName();
  const pendingReload = pendingGlossaryTermReloads.get(termId);
  if (pendingReload) {
    return pendingReload;
  }

  const reloadPromise = (async () => {
    const team = selectedTeam();
    if (!Number.isFinite(team?.installationId) || !repoName) {
      return null;
    }

    try {
      const { invoke } = await import("./runtime.js");
      const payload = await invoke("load_gtms_glossary_term", {
        input: {
          installationId: team.installationId,
          glossaryId,
          repoName,
          termId,
        },
      });
      if (
        state.glossaryEditor?.glossaryId !== glossaryId
        || state.glossaryEditor?.repoName !== repoName
      ) {
        return null;
      }
      const payloadTerm = payload?.term ? normalizeGlossaryTerm(payload.term) : null;
      if (!payloadTerm) {
        removeVisibleGlossaryTerm(termId);
        render?.();
        if (options.suppressNotice !== true) {
          showNoticeBadge("The term was deleted remotely.", render);
        }
        return null;
      }

      const updatedTerm = updateGlossaryEditorTerm(termId, () => payloadTerm) ?? payloadTerm;
      render?.();
      return updatedTerm;
    } catch (error) {
      if (options.suppressNotice !== true) {
        const message = error instanceof Error ? error.message : String(error);
        showNoticeBadge(message || "The latest term could not be loaded.", render);
      }
      return null;
    }
  })();

  pendingGlossaryTermReloads.set(termId, reloadPromise);
  try {
    return await reloadPromise;
  } finally {
    pendingGlossaryTermReloads.delete(termId);
  }
}

export async function ensureGlossaryTermReadyForEdit(render, termId, options = {}) {
  const term = findGlossaryTermById(termId, state.glossaryEditor);
  if (!term) {
    return null;
  }

  if (term.freshness !== "stale" && term.remotelyDeleted !== true) {
    return term;
  }

  return loadGlossaryTermFromDisk(render, termId, {
    suppressNotice: options.suppressNotice === true,
  });
}
