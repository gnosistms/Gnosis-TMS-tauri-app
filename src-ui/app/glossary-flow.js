import { invoke, waitForNextPaint } from "./runtime.js";
import { beginPageSync, completePageSync, failPageSync } from "./page-sync.js";
import {
  createGlossaryEditorState,
  resetGlossaryCreation,
  resetGlossaryTermEditor,
  state,
} from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import { findIsoLanguageOption } from "../lib/language-options.js";

function openGlossaryImportFilePicker() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".tmx,text/xml,application/xml";
    input.style.display = "none";

    const cleanup = () => {
      input.removeEventListener("change", handleChange);
      input.removeEventListener("cancel", handleCancel);
      if (input.parentNode) {
        input.parentNode.removeChild(input);
      }
    };

    const handleChange = () => {
      const file = input.files?.[0] ?? null;
      cleanup();
      resolve(file);
    };

    const handleCancel = () => {
      cleanup();
      resolve(null);
    };

    input.addEventListener("change", handleChange, { once: true });
    input.addEventListener("cancel", handleCancel, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

function detectGlossaryImportFileType(fileName) {
  const normalized = String(fileName || "").trim().toLowerCase();
  if (normalized.endsWith(".tmx")) {
    return "tmx";
  }
  return null;
}

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

function normalizeEditableTerms(terms) {
  const normalized = (Array.isArray(terms) ? terms : [])
    .map((term) => (typeof term === "string" ? term : ""));

  return normalized.length > 0 ? normalized : [""];
}

function sanitizeEditableTerms(terms) {
  return (Array.isArray(terms) ? terms : [])
    .map((term) => String(term ?? "").trim())
    .filter(Boolean);
}

function sanitizeEditableTargetTerms(terms) {
  const sanitized = [];
  const seen = new Set();
  let includedEmptyVariant = false;

  for (const term of Array.isArray(terms) ? terms : []) {
    const trimmed = String(term ?? "").trim();
    if (!trimmed) {
      if (!includedEmptyVariant) {
        sanitized.push("");
        includedEmptyVariant = true;
      }
      continue;
    }

    if (seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    sanitized.push(trimmed);
  }

  return sanitized;
}

export function primeGlossariesLoadingState(teamId = state.selectedTeamId) {
  const team = selectedTeam(teamId);
  state.selectedTeamId = teamId ?? state.selectedTeamId;

  if (!Number.isFinite(team?.installationId)) {
    state.glossaries = [];
    state.selectedGlossaryId = null;
    state.glossaryDiscovery = { status: "ready", error: "" };
    return;
  }

  state.glossaries = [];
  state.selectedGlossaryId = null;
  state.glossaryDiscovery = { status: "loading", error: "" };
}

export function primeSelectedGlossaryEditorLoadingState() {
  const glossary = selectedGlossary();
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
    glossaryId: glossary.id,
    repoName: glossary.repoName,
    title: glossary.title,
    sourceLanguage: glossary.sourceLanguage,
    targetLanguage: glossary.targetLanguage,
    lifecycleState: glossary.lifecycleState,
    termCount: glossary.termCount,
    searchQuery: preservedSearchQuery,
  };
}

function updateGlossaryTermArray(side, updater) {
  if (!state.glossaryTermEditor?.isOpen) {
    return;
  }

  const field = side === "target" ? "targetTerms" : "sourceTerms";
  const currentTerms = normalizeEditableTerms(state.glossaryTermEditor[field]);
  const nextTerms = normalizeEditableTerms(updater(currentTerms));

  state.glossaryTermEditor[field] = nextTerms;
  if (state.glossaryTermEditor.error) {
    state.glossaryTermEditor.error = "";
  }
}

export async function loadTeamGlossaries(
  render,
  teamId = state.selectedTeamId,
  options = {},
) {
  const preserveVisibleData = options.preserveVisibleData === true;
  const team = selectedTeam(teamId);
  state.selectedTeamId = teamId ?? state.selectedTeamId;

  if (!Number.isFinite(team?.installationId)) {
    state.glossaries = [];
    state.selectedGlossaryId = null;
    state.glossaryDiscovery = { status: "ready", error: "" };
    render();
    return;
  }

  if (!preserveVisibleData && state.glossaries.length === 0) {
    state.glossaryDiscovery = { status: "loading", error: "" };
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

    state.glossaryDiscovery = { status: "ready", error: "" };
    await completePageSync(render);
    render();
  } catch (error) {
    failPageSync();
    if (!preserveVisibleData || state.glossaryDiscovery?.status !== "ready") {
      state.glossaryDiscovery = {
        status: "error",
        error: error?.message ?? String(error),
      };
    }
    showNoticeBadge(error?.message ?? String(error), render);
    render();
  }
}

export async function loadSelectedGlossaryEditorData(render, options = {}) {
  const preserveVisibleData = options.preserveVisibleData === true;
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
      glossaryId: glossary.id,
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
    render();
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

export async function openGlossaryEditor(render, glossaryId) {
  state.selectedGlossaryId = glossaryId;
  state.screen = "glossaryEditor";
  primeSelectedGlossaryEditorLoadingState();
  render();
  await loadSelectedGlossaryEditorData(render);
}

export function openGlossaryCreation(render) {
  const team = selectedTeam();
  if (!Number.isFinite(team?.installationId)) {
    showNoticeBadge("Creating a glossary requires a GitHub App-connected team.", render);
    return;
  }

  if (team.canManageProjects !== true) {
    showNoticeBadge("You do not have permission to create glossaries in this team.", render);
    return;
  }

  state.glossaryCreation = {
    isOpen: true,
    status: "idle",
    error: "",
    title: "",
    sourceLanguageCode: "",
    targetLanguageCode: "",
  };
  render();
}

export function cancelGlossaryCreation(render) {
  resetGlossaryCreation();
  render();
}

export function updateGlossaryCreationField(field, value) {
  if (!state.glossaryCreation?.isOpen) {
    return;
  }

  state.glossaryCreation[field] = value;
  if (state.glossaryCreation.error) {
    state.glossaryCreation.error = "";
  }
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
    sourceTerms: normalizeEditableTerms(term?.sourceTerms ?? []),
    targetTerms: normalizeEditableTerms(term?.targetTerms ?? []),
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
}

export function addGlossaryTermVariant(side) {
  updateGlossaryTermArray(side, (terms) => [...terms, ""]);
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
}

export async function submitGlossaryTermEditor(render) {
  const team = selectedTeam();
  const repoName = selectedGlossaryRepoName();
  const draft = state.glossaryTermEditor;
  if (!draft?.isOpen || !Number.isFinite(team?.installationId) || !repoName) {
    return;
  }

  const sourceTerms = sanitizeEditableTerms(draft.sourceTerms);
  if (sourceTerms.length === 0) {
    state.glossaryTermEditor.error = "Enter at least one source term.";
    render();
    return;
  }

  const targetTerms = sanitizeEditableTargetTerms(draft.targetTerms);

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
        targetTerms,
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

export async function submitGlossaryCreation(render) {
  const team = selectedTeam();
  const draft = state.glossaryCreation;
  if (!draft?.isOpen) {
    return;
  }

  if (!Number.isFinite(team?.installationId)) {
    state.glossaryCreation.error = "Creating a glossary requires a GitHub App-connected team.";
    render();
    return;
  }

  if (team.canManageProjects !== true) {
    state.glossaryCreation.error = "You do not have permission to create glossaries in this team.";
    render();
    return;
  }

  const title = String(draft.title ?? "").trim();
  const sourceLanguageCode = String(draft.sourceLanguageCode ?? "").trim().toLowerCase();
  const targetLanguageCode = String(draft.targetLanguageCode ?? "").trim().toLowerCase();
  const sourceLanguage = findIsoLanguageOption(sourceLanguageCode);
  const targetLanguage = findIsoLanguageOption(targetLanguageCode);

  if (!title) {
    state.glossaryCreation.error = "Enter a glossary name.";
    render();
    return;
  }

  if (!sourceLanguage) {
    state.glossaryCreation.error = "Select a source language.";
    render();
    return;
  }

  if (!targetLanguage) {
    state.glossaryCreation.error = "Select a target language.";
    render();
    return;
  }

  state.glossaryCreation.status = "loading";
  state.glossaryCreation.error = "";
  render();
  await waitForNextPaint();

  try {
    const glossary = await invoke("create_local_gtms_glossary", {
      input: {
        installationId: team.installationId,
        title,
        sourceLanguageCode: sourceLanguage.code,
        sourceLanguageName: sourceLanguage.name,
        targetLanguageCode: targetLanguage.code,
        targetLanguageName: targetLanguage.name,
      },
    });
    resetGlossaryCreation();
    state.selectedGlossaryId = glossary.glossaryId;
    await loadTeamGlossaries(render, team.id);
    await openGlossaryEditor(render, glossary.glossaryId);
    showNoticeBadge(`Created glossary ${glossary.title}.`, render);
  } catch (error) {
    state.glossaryCreation.status = "idle";
    state.glossaryCreation.error = error?.message ?? String(error);
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

export async function importGlossaryFromTmx(render) {
  const team = selectedTeam();
  if (!Number.isFinite(team?.installationId)) {
    showNoticeBadge("Importing a glossary requires a GitHub App-connected team.", render);
    return;
  }

  if (team.canManageProjects !== true) {
    showNoticeBadge("You do not have permission to import glossaries in this team.", render);
    return;
  }

  const selectedFile = await openGlossaryImportFilePicker();
  if (!selectedFile) {
    return;
  }

  const fileType = detectGlossaryImportFileType(selectedFile.name);
  if (fileType !== "tmx") {
    showNoticeBadge(
      `Unsupported file type for ${selectedFile.name}. TMX is the only supported glossary import format right now.`,
      render,
    );
    return;
  }

  beginPageSync();
  render();
  await waitForNextPaint();

  try {
    const bytes = Array.from(new Uint8Array(await selectedFile.arrayBuffer()));
    const glossary = await invoke("import_tmx_to_local_gtms_glossary", {
      input: {
        installationId: team.installationId,
        fileName: selectedFile.name,
        bytes,
      },
    });

    state.selectedGlossaryId = glossary.glossaryId;
    await loadTeamGlossaries(render, team.id);
    await openGlossaryEditor(render, glossary.glossaryId);
    showNoticeBadge(
      `Imported ${glossary.termCount} terms from ${selectedFile.name} into ${glossary.title}.`,
      render,
    );
  } catch (error) {
    failPageSync();
    showNoticeBadge(error?.message ?? String(error), render);
    render();
  }
}
