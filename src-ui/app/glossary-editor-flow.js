import { invoke, waitForNextPaint } from "./runtime.js";
import { beginPageSync, completePageSync, failPageSync } from "./page-sync.js";
import { createGlossaryEditorState, state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import {
  applyGlossaryEditorPayload,
  canManageGlossaries,
  selectedGlossary,
  selectedGlossaryRepoName,
  selectedTeam,
  upsertGlossarySummary,
} from "./glossary-shared.js";
import {
  getGlossarySyncIssueMessage,
  syncSingleGlossaryForTeam,
} from "./glossary-repo-flow.js";

function resolveGlossaryForEditor(glossaryId = state.selectedGlossaryId, preferredGlossary = null) {
  const selected = selectedGlossary();
  if (selected?.repoName) {
    return selected;
  }

  const normalizedPreferred = upsertGlossarySummary(preferredGlossary);
  if (normalizedPreferred?.repoName) {
    return normalizedPreferred;
  }

  const editorGlossaryId = state.glossaryEditor?.glossaryId ?? null;
  const requestedGlossaryId = glossaryId ?? editorGlossaryId;
  if (
    requestedGlossaryId
    && state.glossaryEditor?.repoName
    && (editorGlossaryId === requestedGlossaryId || state.selectedGlossaryId == null)
  ) {
    return {
      id: requestedGlossaryId,
      repoName: state.glossaryEditor.repoName,
      title: state.glossaryEditor.title,
      sourceLanguage: state.glossaryEditor.sourceLanguage,
      targetLanguage: state.glossaryEditor.targetLanguage,
      lifecycleState: state.glossaryEditor.lifecycleState,
      termCount: state.glossaryEditor.termCount,
    };
  }

  return null;
}

export function primeSelectedGlossaryEditorLoadingState(options = {}) {
  const glossaryId = options.glossaryId ?? state.selectedGlossaryId;
  const glossary = resolveGlossaryForEditor(glossaryId, options.preferredGlossary ?? null);
  const preservedSearchQuery = state.glossaryEditor?.searchQuery ?? "";

  if (!glossary?.repoName) {
    state.glossaryEditor = {
      ...createGlossaryEditorState(),
      status: "error",
      error: "Could not determine which glossary to open.",
      searchQuery: preservedSearchQuery,
    };
    return;
  }

  state.glossaryEditor = {
    ...createGlossaryEditorState(),
    status: "loading",
    error: "",
    glossaryId,
    repoName: glossary.repoName,
    title: glossary.title,
    sourceLanguage: glossary.sourceLanguage,
    targetLanguage: glossary.targetLanguage,
    lifecycleState: glossary.lifecycleState,
    termCount: glossary.termCount,
    searchQuery: preservedSearchQuery,
  };
}

export async function loadSelectedGlossaryEditorData(render, options = {}) {
  const preserveVisibleData = options.preserveVisibleData === true;
  const glossaryId = options.glossaryId ?? state.selectedGlossaryId ?? state.glossaryEditor?.glossaryId ?? null;
  const team = selectedTeam();
  const glossary = resolveGlossaryForEditor(glossaryId, options.preferredGlossary ?? null);
  if (!Number.isFinite(team?.installationId) || !glossary?.repoName) {
    state.glossaryEditor = {
      ...state.glossaryEditor,
      status: "error",
      error: "Could not determine which glossary to open.",
      terms: [],
    };
    render();
    return;
  }

  beginPageSync();
  if (preserveVisibleData && state.glossaryEditor?.status === "ready") {
    state.glossaryEditor = {
      ...state.glossaryEditor,
      error: "",
      glossaryId: glossary.id,
      repoName: glossary.repoName,
      title: glossary.title,
      sourceLanguage: glossary.sourceLanguage,
      targetLanguage: glossary.targetLanguage,
      lifecycleState: glossary.lifecycleState,
      termCount: glossary.termCount,
    };
  } else {
    state.glossaryEditor = {
      ...state.glossaryEditor,
      status: "loading",
      error: "",
      glossaryId,
      repoName: glossary.repoName,
      title: glossary.title,
      sourceLanguage: glossary.sourceLanguage,
      targetLanguage: glossary.targetLanguage,
      lifecycleState: glossary.lifecycleState,
      termCount: glossary.termCount,
      terms: [],
    };
  }
  render();
  await waitForNextPaint();

  try {
    const payload = await invoke("load_gtms_glossary_editor_data", {
      input: {
        installationId: team.installationId,
        repoName: glossary.repoName,
      },
    });
    applyGlossaryEditorPayload(payload);
    await completePageSync(render);
  } catch (error) {
    failPageSync();
    if (!preserveVisibleData || state.glossaryEditor?.status !== "ready") {
      state.glossaryEditor = {
        ...state.glossaryEditor,
        status: "error",
        error: error?.message ?? String(error),
        terms: [],
      };
    }
    showNoticeBadge(error?.message ?? String(error), render);
    render();
  }
}

export async function openGlossaryEditor(render, glossaryId, options = {}) {
  state.selectedGlossaryId = glossaryId;
  state.screen = "glossaryEditor";
  primeSelectedGlossaryEditorLoadingState({
    glossaryId,
    preferredGlossary: options.preferredGlossary ?? null,
  });
  render();
  await loadSelectedGlossaryEditorData(render, {
    glossaryId,
    preferredGlossary: options.preferredGlossary ?? null,
  });
}

export function updateGlossaryTermSearchQuery(render, value) {
  state.glossaryEditor = {
    ...state.glossaryEditor,
    searchQuery: value,
  };
  render();
}

export async function deleteGlossaryTerm(render, termId) {
  const team = selectedTeam();
  const repoName = selectedGlossaryRepoName();
  if (!Number.isFinite(team?.installationId) || !repoName || !termId) {
    return;
  }

  if (!canManageGlossaries(team)) {
    showNoticeBadge("You do not have permission to edit glossary terms in this team.", render);
    return;
  }

  try {
    await invoke("delete_gtms_glossary_term", {
      input: {
        installationId: team.installationId,
        repoName,
        termId,
      },
    });
    const syncIssue = getGlossarySyncIssueMessage(
      await syncSingleGlossaryForTeam(team, selectedGlossary()),
    );
    if (syncIssue) {
      showNoticeBadge(syncIssue, render);
    }
    await loadSelectedGlossaryEditorData(render);
  } catch (error) {
    showNoticeBadge(error?.message ?? String(error), render);
  }
}

export function showGlossaryFeatureNotReady(render, label = "This glossary action") {
  showNoticeBadge(`${label} is not implemented yet.`, render);
}
