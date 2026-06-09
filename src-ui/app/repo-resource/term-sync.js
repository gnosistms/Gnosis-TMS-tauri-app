import { invoke } from "../runtime.js";
import { state } from "../state.js";
import { showNoticeBadge } from "../status-feedback.js";

function resourceNameFromEditorField(editorField) {
  return String(editorField ?? "").replace(/Editor$/, "");
}

function collectionFieldFromResourceName(resourceName) {
  return resourceName.endsWith("y")
    ? `${resourceName.slice(0, -1)}ies`
    : `${resourceName}s`;
}

function resourceIdFieldFromResourceName(resourceName) {
  return `${resourceName}Id`;
}

export function createRepoResourceTermSync(descriptor) {
  const {
    editorField,
    normalizeTerm,
    selectedRepoName,
    selectedTeam,
    loadTermCommand,
    buildTermFields,
    termNoun,
  } = descriptor;
  const resourceName = resourceNameFromEditorField(editorField);
  const collectionField = collectionFieldFromResourceName(resourceName);
  const resourceIdField = resourceIdFieldFromResourceName(resourceName);
  const pendingTermReloads = new Map();

  function currentEditor() {
    return state[editorField] ?? null;
  }

  function currentResourceId() {
    return currentEditor()?.[resourceIdField] ?? null;
  }

  function findTermById(termId, resourceState = currentEditor()) {
    if (!termId || !Array.isArray(resourceState?.terms)) {
      return null;
    }

    return resourceState.terms.find((term) => term?.termId === termId) ?? null;
  }

  function termUiFields(term = {}) {
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

  function withTermUiFields(term, uiFields = {}) {
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

  function normalizedVisibleTerm(term, uiFields = {}) {
    const normalized = normalizeTerm(term);
    return normalized ? withTermUiFields(normalized, uiFields) : null;
  }

  function updateSummaryTermCount(resourceId, repoName, termCount) {
    if (!Number.isFinite(termCount)) {
      return;
    }

    state[collectionField] = (Array.isArray(state[collectionField]) ? state[collectionField] : [])
      .map((resource) => {
        if (resource?.id !== resourceId && resource?.repoName !== repoName) {
          return resource;
        }
        return {
          ...resource,
          termCount,
        };
      });
  }

  function setEditorTerms(terms, options = {}) {
    const editor = currentEditor();
    const resourceId = currentResourceId();
    if (!resourceId) {
      return false;
    }

    const termCount = Number.isFinite(options.termCount) ? options.termCount : terms.length;
    state[editorField] = {
      ...editor,
      terms,
      termCount,
    };
    updateSummaryTermCount(resourceId, editor?.repoName, termCount);
    return true;
  }

  function updateEditorTerm(termId, updater) {
    const editor = currentEditor();
    if (!currentResourceId() || !Array.isArray(editor?.terms)) {
      return null;
    }

    let updatedTerm = null;
    const terms = editor.terms.map((term) => {
      if (!term || term.termId !== termId) {
        return term;
      }

      updatedTerm = updater(term);
      return updatedTerm;
    });
    if (!updatedTerm) {
      return null;
    }

    setEditorTerms(terms, { termCount: currentEditor()?.termCount });
    return updatedTerm;
  }

  function buildTermFromDraft(draftSnapshot, options = {}) {
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

    return normalizedVisibleTerm(
      {
        termId,
        ...buildTermFields(draftSnapshot),
        lifecycleState: "active",
      },
      {
        pendingMutation: options.pendingMutation ?? null,
        pendingError: options.pendingError ?? "",
        optimisticClientId: options.optimisticClientId ?? null,
      },
    );
  }

  function upsertVisibleTerm(term, options = {}) {
    const editor = currentEditor();
    if (!currentResourceId() || !Array.isArray(editor?.terms)) {
      return null;
    }

    const normalized = normalizedVisibleTerm(term, {
      ...termUiFields(term),
      pendingMutation: options.pendingMutation ?? term?.pendingMutation ?? null,
      pendingError: options.pendingError ?? term?.pendingError ?? "",
      optimisticClientId: options.optimisticClientId ?? term?.optimisticClientId ?? null,
    });
    if (!normalized) {
      return null;
    }

    let matched = false;
    const terms = editor.terms.map((currentTerm) => {
      if (currentTerm?.termId !== normalized.termId) {
        return currentTerm;
      }
      matched = true;
      return normalized;
    });
    if (!matched) {
      terms.push(normalized);
    }

    const currentTermCount = Number.isFinite(editor.termCount)
      ? editor.termCount
      : editor.terms.length;
    setEditorTerms(terms, {
      termCount: matched ? currentTermCount : currentTermCount + 1,
    });
    return normalized;
  }

  function replaceOptimisticTerm(clientId, confirmedTerm, options = {}) {
    const editor = currentEditor();
    if (!clientId || !currentResourceId() || !Array.isArray(editor?.terms)) {
      return null;
    }

    const normalized = normalizedVisibleTerm(confirmedTerm);
    if (!normalized) {
      return null;
    }

    let replaced = false;
    const terms = [];
    for (const term of editor.terms) {
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

    setEditorTerms(terms, {
      termCount: Number.isFinite(options.termCount)
        ? options.termCount
        : currentEditor()?.termCount,
    });
    return normalized;
  }

  function markVisibleTermConfirmed(termId, confirmedTerm, options = {}) {
    const existingTerm = findTermById(termId);
    const confirmed = normalizedVisibleTerm(confirmedTerm ?? existingTerm);
    if (!confirmed) {
      return null;
    }

    if (termId && termId !== confirmed.termId) {
      return replaceOptimisticTerm(termId, confirmed, options);
    }

    const updated = updateEditorTerm(termId, () => confirmed) ?? upsertVisibleTerm(confirmed);
    if (updated && Number.isFinite(options.termCount) && currentResourceId()) {
      setEditorTerms(currentEditor().terms, { termCount: options.termCount });
    }
    return updated;
  }

  function markVisibleTermFailed(termId, message) {
    return updateEditorTerm(termId, (term) =>
      withTermUiFields(term, {
        ...termUiFields(term),
        pendingMutation: null,
        pendingError: typeof message === "string" ? message : String(message ?? ""),
      }),
    );
  }

  function removeVisibleTerm(termId) {
    const editor = currentEditor();
    if (!currentResourceId() || !Array.isArray(editor?.terms)) {
      return;
    }

    const terms = editor.terms.filter((term) => term?.termId !== termId);
    setEditorTerms(terms, { termCount: terms.length });
  }

  function applyTermsStale(terms, syncResult = {}) {
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

  function markTermsStale(syncResult = {}) {
    const editor = currentEditor();
    if (!currentResourceId() || !Array.isArray(editor?.terms)) {
      return;
    }

    state[editorField] = {
      ...editor,
      terms: applyTermsStale(editor.terms, syncResult),
    };
  }

  async function loadTermFromDisk(render, termId, options = {}) {
    const resourceId = currentResourceId();
    if (!termId || !resourceId) {
      return null;
    }

    const repoName = selectedRepoName();
    const pendingReload = pendingTermReloads.get(termId);
    if (pendingReload) {
      return pendingReload;
    }

    const reloadPromise = (async () => {
      const team = selectedTeam();
      if (!Number.isFinite(team?.installationId) || !repoName) {
        return null;
      }

      try {
        const payload = await invoke(loadTermCommand, {
          input: {
            installationId: team.installationId,
            [resourceIdField]: resourceId,
            repoName,
            termId,
          },
        });
        if (
          currentEditor()?.[resourceIdField] !== resourceId
          || currentEditor()?.repoName !== repoName
        ) {
          return null;
        }
        const payloadTerm = payload?.term ? normalizeTerm(payload.term) : null;
        if (!payloadTerm) {
          removeVisibleTerm(termId);
          render?.();
          if (options.suppressNotice !== true) {
            showNoticeBadge(`The ${termNoun} was deleted remotely.`, render);
          }
          return null;
        }

        const updatedTerm = updateEditorTerm(termId, () => payloadTerm) ?? payloadTerm;
        render?.();
        return updatedTerm;
      } catch (error) {
        if (options.suppressNotice !== true) {
          const message = error instanceof Error ? error.message : String(error);
          showNoticeBadge(message || `The latest ${termNoun} could not be loaded.`, render);
        }
        return null;
      }
    })();

    pendingTermReloads.set(termId, reloadPromise);
    try {
      return await reloadPromise;
    } finally {
      pendingTermReloads.delete(termId);
    }
  }

  async function ensureTermReadyForEdit(render, termId, options = {}) {
    const term = findTermById(termId, currentEditor());
    if (!term) {
      return null;
    }

    if (term.freshness !== "stale" && term.remotelyDeleted !== true) {
      return term;
    }

    return loadTermFromDisk(render, termId, {
      suppressNotice: options.suppressNotice === true,
    });
  }

  return {
    findTermById,
    buildTermFromDraft,
    upsertVisibleTerm,
    replaceOptimisticTerm,
    markVisibleTermConfirmed,
    markVisibleTermFailed,
    removeVisibleTerm,
    applyTermsStale,
    markTermsStale,
    loadTermFromDisk,
    ensureTermReadyForEdit,
  };
}
