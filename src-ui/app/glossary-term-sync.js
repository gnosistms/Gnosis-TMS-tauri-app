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

  state.glossaryEditor = {
    ...state.glossaryEditor,
    terms,
  };
  return updatedTerm;
}

function removeGlossaryEditorTerm(termId) {
  if (!state.glossaryEditor?.glossaryId || !Array.isArray(state.glossaryEditor.terms)) {
    return;
  }

  const terms = state.glossaryEditor.terms.filter((term) => term?.termId !== termId);
  state.glossaryEditor = {
    ...state.glossaryEditor,
    terms,
    termCount: terms.length,
  };
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
        removeGlossaryEditorTerm(termId);
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
