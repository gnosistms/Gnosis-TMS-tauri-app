import {
  editorGlossaryStateMatchesLink,
  loadEditorGlossaryState,
  normalizeEditorGlossaryLink,
} from "./editor-glossary-flow.js";
import { normalizeEditorChapterFilterState } from "./editor-filters.js";
import { normalizeLanguageSelections } from "./editor-selection-flow.js";
import { hasActiveEditorField } from "./editor-utils.js";
import {
  ensureProjectNotTombstoned,
} from "./project-chapter-flow.js";
import { findChapterContextById, selectedProjectsTeam } from "./project-context.js";
import { invoke } from "./runtime.js";
import {
  createEditorChapterFilterState,
  createEditorChapterGlossaryState,
  createEditorHistoryState,
  state,
} from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";

function normalizeEditorChapterFilters(filters) {
  return normalizeEditorChapterFilterState(filters);
}

function hasEditorChapterLoadOperations(operations) {
  return (
    typeof operations?.applyEditorUiState === "function"
    && typeof operations?.normalizeEditorRows === "function"
    && typeof operations?.applyChapterMetadataToState === "function"
    && typeof operations?.loadActiveEditorFieldHistory === "function"
    && typeof operations?.flushDirtyEditorRows === "function"
    && typeof operations?.persistEditorChapterSelections === "function"
  );
}

function applyEditorPayloadToState(payload, projectId, existingChapter = {}, glossaryState = null, operations = {}) {
  if (!hasEditorChapterLoadOperations(operations)) {
    return;
  }

  const previousEditorChapter = state.editorChapter;
  const { selectedSourceLanguageCode, selectedTargetLanguageCode } = normalizeLanguageSelections(
    payload.languages,
    existingChapter.selectedSourceLanguageCode ?? payload.selectedSourceLanguageCode,
    existingChapter.selectedTargetLanguageCode ?? payload.selectedTargetLanguageCode,
  );

  state.editorChapter = operations.applyEditorUiState({
    status: "ready",
    error: "",
    projectId,
    chapterId: payload.chapterId,
    fileTitle: payload.fileTitle,
    languages: Array.isArray(payload.languages) ? payload.languages : [],
    sourceWordCounts:
      payload.sourceWordCounts && typeof payload.sourceWordCounts === "object"
        ? payload.sourceWordCounts
        : {},
    selectedSourceLanguageCode,
    selectedTargetLanguageCode,
    persistedSourceLanguageCode: selectedSourceLanguageCode,
    persistedTargetLanguageCode: selectedTargetLanguageCode,
    selectionPersistStatus: "idle",
    glossary: glossaryState ?? previousEditorChapter?.glossary ?? createEditorChapterGlossaryState(),
    rows: operations.normalizeEditorRows(payload.rows),
  }, previousEditorChapter);

  operations.applyChapterMetadataToState(payload.chapterId, {
    name: payload.fileTitle,
    languages: state.editorChapter.languages,
    sourceWordCounts: state.editorChapter.sourceWordCounts,
    selectedSourceLanguageCode,
    selectedTargetLanguageCode,
  });
}

export async function loadSelectedChapterEditorData(render, options = {}, operations = {}) {
  if (!hasEditorChapterLoadOperations(operations)) {
    return;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById();
  if (!context || !Number.isFinite(team?.installationId)) {
    state.editorChapter = {
      ...state.editorChapter,
      status: "error",
      error: "Could not determine which file to open.",
    };
    render?.();
    return;
  }
  if (await ensureProjectNotTombstoned(render, team, context.project)) {
    state.editorChapter = {
      ...state.editorChapter,
      status: "error",
      error: "This project was permanently deleted.",
      rows: [],
    };
    render?.();
    return;
  }

  const preserveVisibleRows =
    options.preserveVisibleRows === true
    && state.screen === "translate"
    && state.editorChapter?.chapterId === context.chapter.id
    && Array.isArray(state.editorChapter.rows)
    && state.editorChapter.rows.length > 0;
  const nextSelectedSourceLanguageCode = preserveVisibleRows
    ? state.editorChapter.selectedSourceLanguageCode
    : context.chapter.selectedSourceLanguageCode ?? null;
  const nextSelectedTargetLanguageCode = preserveVisibleRows
    ? state.editorChapter.selectedTargetLanguageCode
    : context.chapter.selectedTargetLanguageCode ?? null;
  const linkedGlossary = normalizeEditorGlossaryLink(context.chapter.linkedGlossary);
  const nextGlossaryState =
    preserveVisibleRows && editorGlossaryStateMatchesLink(state.editorChapter?.glossary, linkedGlossary)
      ? state.editorChapter.glossary
      : linkedGlossary
        ? {
          ...createEditorChapterGlossaryState(),
          status: "loading",
          glossaryId: linkedGlossary.glossaryId,
          repoName: linkedGlossary.repoName,
        }
        : createEditorChapterGlossaryState();
  const glossaryStatePromise = loadEditorGlossaryState(team, context.chapter);

  state.selectedProjectId = context.project.id;
  state.editorChapter = {
    ...state.editorChapter,
    status: preserveVisibleRows ? "refreshing" : "loading",
    error: "",
    projectId: context.project.id,
    chapterId: context.chapter.id,
    fileTitle: context.chapter.name ?? "",
    languages: preserveVisibleRows
      ? state.editorChapter.languages
      : Array.isArray(context.chapter.languages) ? context.chapter.languages : [],
    sourceWordCounts:
      preserveVisibleRows
        ? state.editorChapter.sourceWordCounts
        : context.chapter.sourceWordCounts && typeof context.chapter.sourceWordCounts === "object"
          ? context.chapter.sourceWordCounts
          : {},
    selectedSourceLanguageCode: nextSelectedSourceLanguageCode,
    selectedTargetLanguageCode: nextSelectedTargetLanguageCode,
    persistedSourceLanguageCode: nextSelectedSourceLanguageCode,
    persistedTargetLanguageCode: nextSelectedTargetLanguageCode,
    selectionPersistStatus: "idle",
    filters: preserveVisibleRows
      ? normalizeEditorChapterFilters(state.editorChapter.filters)
      : createEditorChapterFilterState(),
    glossary: nextGlossaryState,
    activeRowId: preserveVisibleRows ? state.editorChapter.activeRowId : null,
    activeLanguageCode: preserveVisibleRows ? state.editorChapter.activeLanguageCode : null,
    history: preserveVisibleRows ? state.editorChapter.history : createEditorHistoryState(),
    rows: preserveVisibleRows ? state.editorChapter.rows : [],
  };
  render?.();

  try {
    const payload = await invoke("load_gtms_chapter_editor_data", {
      input: {
        installationId: team.installationId,
        projectId: context.project.id,
        repoName: context.project.name,
        chapterId: context.chapter.id,
      },
    });
    const glossaryState = await glossaryStatePromise;
    applyEditorPayloadToState(payload, context.project.id, context.chapter, glossaryState, operations);
    render?.();
    if (hasActiveEditorField(state.editorChapter)) {
      operations.loadActiveEditorFieldHistory(render);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.editorChapter = {
      ...state.editorChapter,
      status: "error",
      error: message,
      activeRowId: null,
      activeLanguageCode: null,
      history: createEditorHistoryState(),
      rows: [],
    };
    showNoticeBadge(message || "The file could not be loaded.", render);
    render?.();
  }
}

export async function openTranslateChapter(render, chapterId, operations = {}) {
  if (!hasEditorChapterLoadOperations(operations)) {
    return;
  }

  const context = findChapterContextById(chapterId);
  if (!context) {
    showNoticeBadge("Could not determine which file to open.", render);
    return;
  }

  if (!(await operations.flushDirtyEditorRows(render))) {
    showNoticeBadge("Finish saving the current row before opening a different file.", render);
    return;
  }

  void operations.persistEditorChapterSelections(render);
  state.selectedProjectId = context.project.id;
  state.selectedChapterId = chapterId;
  state.screen = "translate";
  await loadSelectedChapterEditorData(render, {}, operations);
}
