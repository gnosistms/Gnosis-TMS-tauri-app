import { invoke, waitForNextPaint } from "./runtime.js";
import { beginPageSync, completePageSync, failPageSync } from "./page-sync.js";
import { resetGlossaryTermEditor, state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";

function selectedTeam(teamId = state.selectedTeamId) {
  return state.teams.find((team) => team.id === teamId) ?? null;
}

function sortGlossaries(glossaries) {
  return [...(Array.isArray(glossaries) ? glossaries : [])].sort((left, right) =>
    String(left?.title ?? "")
      .toLowerCase()
      .localeCompare(String(right?.title ?? "").toLowerCase())
      || String(left?.repoName ?? "").localeCompare(String(right?.repoName ?? "")),
  );
}

function selectedGlossary() {
  return state.glossaries.find((glossary) => glossary.id === state.selectedGlossaryId) ?? null;
}

function selectedGlossaryRepoName() {
  return state.glossaryEditor?.repoName || selectedGlossary()?.repoName || "";
}

function normalizeGlossarySummary(glossary) {
  if (!glossary || typeof glossary !== "object") {
    return null;
  }

  const id =
    typeof glossary.glossaryId === "string" && glossary.glossaryId.trim()
      ? glossary.glossaryId.trim()
      : null;
  const repoName =
    typeof glossary.repoName === "string" && glossary.repoName.trim()
      ? glossary.repoName.trim()
      : null;
  const title =
    typeof glossary.title === "string" && glossary.title.trim()
      ? glossary.title.trim()
      : null;
  if (!id || !repoName || !title) {
    return null;
  }

  return {
    id,
    repoName,
    title,
    sourceLanguage: glossary.sourceLanguage ?? null,
    targetLanguage: glossary.targetLanguage ?? null,
    lifecycleState: glossary.lifecycleState === "deleted" ? "deleted" : "active",
    termCount: Number.isFinite(glossary.termCount) ? glossary.termCount : 0,
  };
}

function normalizeGlossaryTerm(term) {
  if (!term || typeof term !== "object") {
    return null;
  }
  const termId =
    typeof term.termId === "string" && term.termId.trim()
      ? term.termId.trim()
      : null;
  if (!termId) {
    return null;
  }
  return {
    termId,
    sourceTerms: Array.isArray(term.sourceTerms) ? term.sourceTerms : [],
    targetTerms: Array.isArray(term.targetTerms) ? term.targetTerms : [],
    notesToTranslators:
      typeof term.notesToTranslators === "string" ? term.notesToTranslators : "",
    footnote: typeof term.footnote === "string" ? term.footnote : "",
    untranslated: term.untranslated === true,
    lifecycleState: term.lifecycleState === "deleted" ? "deleted" : "active",
  };
}

function applyGlossaryEditorPayload(payload) {
  const normalizedTerms = (Array.isArray(payload?.terms) ? payload.terms : [])
    .map(normalizeGlossaryTerm)
    .filter(Boolean);

  state.glossaryEditor = {
    status: "ready",
    error: "",
    glossaryId: payload.glossaryId,
    repoName: selectedGlossaryRepoName(),
    title: payload.title ?? "",
    lifecycleState: payload.lifecycleState === "deleted" ? "deleted" : "active",
    sourceLanguage: payload.sourceLanguage ?? null,
    targetLanguage: payload.targetLanguage ?? null,
    termCount: Number.isFinite(payload.termCount) ? payload.termCount : normalizedTerms.length,
    searchQuery: state.glossaryEditor?.searchQuery ?? "",
    terms: normalizedTerms,
  };

  state.glossaries = state.glossaries.map((glossary) =>
    glossary.id === payload.glossaryId
      ? {
          ...glossary,
          title: payload.title ?? glossary.title,
          sourceLanguage: payload.sourceLanguage ?? glossary.sourceLanguage,
          targetLanguage: payload.targetLanguage ?? glossary.targetLanguage,
          lifecycleState: payload.lifecycleState ?? glossary.lifecycleState,
          termCount: Number.isFinite(payload.termCount) ? payload.termCount : glossary.termCount,
        }
      : glossary,
  );
}

function parseCommaSeparatedTerms(value) {
  return String(value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export async function loadTeamGlossaries(render, teamId = state.selectedTeamId) {
  const team = selectedTeam(teamId);
  state.selectedTeamId = teamId ?? state.selectedTeamId;

  if (!Number.isFinite(team?.installationId) || state.offline.isEnabled) {
    state.glossaries = [];
    render();
    return;
  }

  beginPageSync();
  render();
  await waitForNextPaint();

  try {
    const glossaries = await invoke("list_local_gtms_glossaries", {
      input: { installationId: team.installationId },
    });
    state.glossaries = sortGlossaries(
      (Array.isArray(glossaries) ? glossaries : [])
        .map(normalizeGlossarySummary)
        .filter(Boolean),
    );

    if (!state.glossaries.some((glossary) => glossary.id === state.selectedGlossaryId)) {
      state.selectedGlossaryId = state.glossaries[0]?.id ?? null;
    }

    await completePageSync(render);
    render();
  } catch (error) {
    failPageSync();
    showNoticeBadge(error?.message ?? String(error), render);
    render();
  }
}

export async function loadSelectedGlossaryEditorData(render) {
  const team = selectedTeam();
  const glossary = selectedGlossary();
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
  state.glossaryEditor = {
    ...state.glossaryEditor,
    status: "loading",
    error: "",
    glossaryId: glossary.id,
    repoName: glossary.repoName,
    title: glossary.title,
    sourceLanguage: glossary.sourceLanguage,
    targetLanguage: glossary.targetLanguage,
    lifecycleState: glossary.lifecycleState,
    termCount: glossary.termCount,
    terms: [],
  };
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
    render();
  } catch (error) {
    failPageSync();
    state.glossaryEditor = {
      ...state.glossaryEditor,
      status: "error",
      error: error?.message ?? String(error),
      terms: [],
    };
    showNoticeBadge(error?.message ?? String(error), render);
    render();
  }
}

export async function openGlossaryEditor(render, glossaryId) {
  state.selectedGlossaryId = glossaryId;
  state.screen = "glossaryEditor";
  render();
  await loadSelectedGlossaryEditorData(render);
}

export function updateGlossariesSearchQuery(render, value) {
  state.glossariesSearchQuery = value;
  render();
}

export function updateGlossaryTermSearchQuery(render, value) {
  state.glossaryEditor = {
    ...state.glossaryEditor,
    searchQuery: value,
  };
  render();
}

export function openGlossaryTermEditor(render, termId = null) {
  const term = termId
    ? state.glossaryEditor.terms.find((item) => item.termId === termId) ?? null
    : null;

  state.glossaryTermEditor = {
    ...state.glossaryTermEditor,
    isOpen: true,
    status: "idle",
    error: "",
    glossaryId: state.glossaryEditor.glossaryId,
    termId: term?.termId ?? null,
    sourceTermsText: term?.sourceTerms?.join(", ") ?? "",
    targetTermsText: term?.targetTerms?.join(", ") ?? "",
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

export async function submitGlossaryTermEditor(render) {
  const team = selectedTeam();
  const repoName = selectedGlossaryRepoName();
  const draft = state.glossaryTermEditor;
  if (!draft?.isOpen || !Number.isFinite(team?.installationId) || !repoName) {
    return;
  }

  const sourceTerms = parseCommaSeparatedTerms(draft.sourceTermsText);
  if (sourceTerms.length === 0) {
    state.glossaryTermEditor.error = "Enter at least one source term.";
    render();
    return;
  }

  state.glossaryTermEditor.status = "loading";
  state.glossaryTermEditor.error = "";
  render();

  try {
    await invoke("upsert_gtms_glossary_term", {
      input: {
        installationId: team.installationId,
        repoName,
        termId: draft.termId || null,
        sourceTerms,
        targetTerms: parseCommaSeparatedTerms(draft.targetTermsText),
        notesToTranslators: draft.notesToTranslators,
        footnote: draft.footnote,
        untranslated: draft.untranslated === true,
      },
    });
    resetGlossaryTermEditor();
    await loadSelectedGlossaryEditorData(render);
  } catch (error) {
    state.glossaryTermEditor.status = "idle";
    state.glossaryTermEditor.error = error?.message ?? String(error);
    render();
  }
}

export async function deleteGlossaryTerm(render, termId) {
  const team = selectedTeam();
  const repoName = selectedGlossaryRepoName();
  if (!Number.isFinite(team?.installationId) || !repoName || !termId) {
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
    await loadSelectedGlossaryEditorData(render);
  } catch (error) {
    showNoticeBadge(error?.message ?? String(error), render);
  }
}

export function showGlossaryFeatureNotReady(render, label = "This glossary action") {
  showNoticeBadge(`${label} is not implemented yet.`, render);
}
