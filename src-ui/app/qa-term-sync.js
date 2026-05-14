import { normalizeQaTerm, selectedQaListRepoName, selectedTeam } from "./qa-list-shared.js";
import { invoke } from "./runtime.js";
import { state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";

const pendingQaTermReloads = new Map();

export function findQaTermById(termId, qaListState = state.qaListEditor) {
  if (!termId || !Array.isArray(qaListState?.terms)) {
    return null;
  }

  return qaListState.terms.find((term) => term?.termId === termId) ?? null;
}

function qaTermUiFields(term = {}) {
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

function withQaTermUiFields(term, uiFields = {}) {
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

function normalizedVisibleQaTerm(term, uiFields = {}) {
  const normalized = normalizeQaTerm(term);
  return normalized ? withQaTermUiFields(normalized, uiFields) : null;
}

function updateQaListSummaryTermCount(qaListId, repoName, termCount) {
  if (!Number.isFinite(termCount)) {
    return;
  }

  state.qaLists = (Array.isArray(state.qaLists) ? state.qaLists : []).map((qaList) => {
    if (qaList?.id !== qaListId && qaList?.repoName !== repoName) {
      return qaList;
    }
    return {
      ...qaList,
      termCount,
    };
  });
}

function setQaListEditorTerms(terms, options = {}) {
  if (!state.qaListEditor?.qaListId) {
    return false;
  }

  const termCount = Number.isFinite(options.termCount) ? options.termCount : terms.length;
  state.qaListEditor = {
    ...state.qaListEditor,
    terms,
    termCount,
  };
  updateQaListSummaryTermCount(
    state.qaListEditor.qaListId,
    state.qaListEditor.repoName,
    termCount,
  );
  return true;
}

function updateQaListEditorTerm(termId, updater) {
  if (!state.qaListEditor?.qaListId || !Array.isArray(state.qaListEditor.terms)) {
    return null;
  }

  let updatedTerm = null;
  const terms = state.qaListEditor.terms.map((term) => {
    if (!term || term.termId !== termId) {
      return term;
    }

    updatedTerm = updater(term);
    return updatedTerm;
  });
  if (!updatedTerm) {
    return null;
  }

  setQaListEditorTerms(terms, { termCount: state.qaListEditor.termCount });
  return updatedTerm;
}

export function buildQaTermFromDraft(draftSnapshot, options = {}) {
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

  return normalizedVisibleQaTerm(
    {
      termId,
      text: typeof draftSnapshot?.text === "string" ? draftSnapshot.text : "",
      notes: typeof draftSnapshot?.notes === "string" ? draftSnapshot.notes : "",
      lifecycleState: "active",
    },
    {
      pendingMutation: options.pendingMutation ?? null,
      pendingError: options.pendingError ?? "",
      optimisticClientId: options.optimisticClientId ?? null,
    },
  );
}

export function upsertVisibleQaTerm(term, options = {}) {
  if (!state.qaListEditor?.qaListId || !Array.isArray(state.qaListEditor.terms)) {
    return null;
  }

  const normalized = normalizedVisibleQaTerm(term, {
    ...qaTermUiFields(term),
    pendingMutation: options.pendingMutation ?? term?.pendingMutation ?? null,
    pendingError: options.pendingError ?? term?.pendingError ?? "",
    optimisticClientId: options.optimisticClientId ?? term?.optimisticClientId ?? null,
  });
  if (!normalized) {
    return null;
  }

  let matched = false;
  const terms = state.qaListEditor.terms.map((currentTerm) => {
    if (currentTerm?.termId !== normalized.termId) {
      return currentTerm;
    }
    matched = true;
    return normalized;
  });
  if (!matched) {
    terms.push(normalized);
  }

  const currentTermCount = Number.isFinite(state.qaListEditor.termCount)
    ? state.qaListEditor.termCount
    : state.qaListEditor.terms.length;
  setQaListEditorTerms(terms, {
    termCount: matched ? currentTermCount : currentTermCount + 1,
  });
  return normalized;
}

export function replaceOptimisticQaTerm(clientId, confirmedTerm, options = {}) {
  if (
    !clientId
    || !state.qaListEditor?.qaListId
    || !Array.isArray(state.qaListEditor.terms)
  ) {
    return null;
  }

  const normalized = normalizedVisibleQaTerm(confirmedTerm);
  if (!normalized) {
    return null;
  }

  let replaced = false;
  const terms = [];
  for (const term of state.qaListEditor.terms) {
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

  setQaListEditorTerms(terms, {
    termCount: Number.isFinite(options.termCount)
      ? options.termCount
      : state.qaListEditor.termCount,
  });
  return normalized;
}

export function markVisibleQaTermConfirmed(termId, confirmedTerm, options = {}) {
  const existingTerm = findQaTermById(termId);
  const confirmed = normalizedVisibleQaTerm(confirmedTerm ?? existingTerm);
  if (!confirmed) {
    return null;
  }

  if (termId && termId !== confirmed.termId) {
    return replaceOptimisticQaTerm(termId, confirmed, options);
  }

  const updated = updateQaListEditorTerm(termId, () => confirmed) ?? upsertVisibleQaTerm(confirmed);
  if (updated && Number.isFinite(options.termCount) && state.qaListEditor?.qaListId) {
    setQaListEditorTerms(state.qaListEditor.terms, { termCount: options.termCount });
  }
  return updated;
}

export function markVisibleQaTermFailed(termId, message) {
  return updateQaListEditorTerm(termId, (term) =>
    withQaTermUiFields(term, {
      ...qaTermUiFields(term),
      pendingMutation: null,
      pendingError: typeof message === "string" ? message : String(message ?? ""),
    }),
  );
}

export function removeVisibleQaTerm(termId) {
  if (!state.qaListEditor?.qaListId || !Array.isArray(state.qaListEditor.terms)) {
    return;
  }

  const terms = state.qaListEditor.terms.filter((term) => term?.termId !== termId);
  setQaListEditorTerms(terms, { termCount: terms.length });
}

export function applyQaTermsStale(terms, syncResult = {}) {
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

export function markQaTermsStale(syncResult = {}) {
  if (!state.qaListEditor?.qaListId || !Array.isArray(state.qaListEditor.terms)) {
    return;
  }

  state.qaListEditor = {
    ...state.qaListEditor,
    terms: applyQaTermsStale(state.qaListEditor.terms, syncResult),
  };
}

export async function loadQaTermFromDisk(render, termId, options = {}) {
  if (!termId || !state.qaListEditor?.qaListId) {
    return null;
  }

  const qaListId = state.qaListEditor.qaListId;
  const repoName = selectedQaListRepoName();
  const pendingReload = pendingQaTermReloads.get(termId);
  if (pendingReload) {
    return pendingReload;
  }

  const reloadPromise = (async () => {
    const team = selectedTeam();
    if (!Number.isFinite(team?.installationId) || !repoName) {
      return null;
    }

    try {
      const payload = await invoke("load_gtms_qa_list_term", {
        input: {
          installationId: team.installationId,
          qaListId,
          repoName,
          termId,
        },
      });
      if (
        state.qaListEditor?.qaListId !== qaListId
        || state.qaListEditor?.repoName !== repoName
      ) {
        return null;
      }
      const payloadTerm = payload?.term ? normalizeQaTerm(payload.term) : null;
      if (!payloadTerm) {
        removeVisibleQaTerm(termId);
        render?.();
        if (options.suppressNotice !== true) {
          showNoticeBadge("The QA term was deleted remotely.", render);
        }
        return null;
      }

      const updatedTerm = updateQaListEditorTerm(termId, () => payloadTerm) ?? payloadTerm;
      render?.();
      return updatedTerm;
    } catch (error) {
      if (options.suppressNotice !== true) {
        const message = error instanceof Error ? error.message : String(error);
        showNoticeBadge(message || "The latest QA term could not be loaded.", render);
      }
      return null;
    }
  })();

  pendingQaTermReloads.set(termId, reloadPromise);
  try {
    return await reloadPromise;
  } finally {
    pendingQaTermReloads.delete(termId);
  }
}

export async function ensureQaTermReadyForEdit(render, termId, options = {}) {
  const term = findQaTermById(termId, state.qaListEditor);
  if (!term) {
    return null;
  }

  if (term.freshness !== "stale" && term.remotelyDeleted !== true) {
    return term;
  }

  return loadQaTermFromDisk(render, termId, {
    suppressNotice: options.suppressNotice === true,
  });
}
