import { saveStoredProjectsForTeam } from "./project-cache.js";
import {
  editorGlossaryStateMatchesLink,
  loadEditorGlossaryState,
  normalizeEditorGlossaryLink,
  restoreMountedEditorGlossaryHighlightsFromCache as restoreMountedEditorGlossaryHighlightsFromCacheFlow,
  syncEditorGlossaryHighlightRowDom as syncEditorGlossaryHighlightRowDomFlow,
  syncVisibleEditorGlossaryHighlightRows as syncVisibleEditorGlossaryHighlightRowsFlow,
} from "./editor-glossary-flow.js";
import {
  replaceSelectedEditorRows as replaceSelectedEditorRowsFlow,
  selectAllEditorReplaceRows as selectAllEditorReplaceRowsFlow,
  toggleEditorReplaceEnabled as toggleEditorReplaceEnabledFlow,
  toggleEditorReplaceRowSelected as toggleEditorReplaceRowSelectedFlow,
  toggleEditorSearchFilterCaseSensitive as toggleEditorSearchFilterCaseSensitiveFlow,
  updateEditorReplaceQuery as updateEditorReplaceQueryFlow,
  updateEditorSearchFilterQuery as updateEditorSearchFilterQueryFlow,
} from "./editor-search-flow.js";
import {
  normalizeLanguageSelections,
  persistEditorChapterSelections as persistEditorChapterSelectionsFlow,
  updateEditorSourceLanguage as updateEditorSourceLanguageFlow,
  updateEditorTargetLanguage as updateEditorTargetLanguageFlow,
} from "./editor-selection-flow.js";
import {
  compactDirtyRowIds,
  flushDirtyEditorRows as flushDirtyEditorRowsFlow,
  persistEditorRowOnBlur as persistEditorRowOnBlurFlow,
  reconcileDirtyTrackedEditorRows,
  scheduleDirtyEditorRowScan as scheduleDirtyEditorRowScanFlow,
  toggleEditorRowFieldMarker as toggleEditorRowFieldMarkerFlow,
  updateEditorRowFieldValue as updateEditorRowFieldValueFlow,
} from "./editor-persistence-flow.js";
import { normalizeEditorChapterFilterState } from "./editor-filters.js";
import {
  normalizeEditorReplaceState,
} from "./editor-replace.js";
import {
  cancelEditorReplaceUndoModal as cancelEditorReplaceUndoModalFlow,
  cloneExpandedHistoryGroupKeys,
  confirmEditorReplaceUndo as confirmEditorReplaceUndoFlow,
  currentEditorHistoryForSelection,
  loadActiveEditorFieldHistory as loadActiveEditorFieldHistoryFlow,
  normalizeEditorHistoryState,
  openEditorReplaceUndoModal as openEditorReplaceUndoModalFlow,
  restoreEditorFieldHistory as restoreEditorFieldHistoryFlow,
  setActiveEditorField as setActiveEditorFieldFlow,
  toggleEditorHistoryGroupExpanded as toggleEditorHistoryGroupExpandedFlow,
} from "./editor-history-flow.js";
import {
  cancelEditorRowPermanentDeletionModal as cancelEditorRowPermanentDeletionModalFlow,
  cancelInsertEditorRowModal as cancelInsertEditorRowModalFlow,
  confirmEditorRowPermanentDeletion as confirmEditorRowPermanentDeletionFlow,
  confirmInsertEditorRow as confirmInsertEditorRowFlow,
  openEditorRowPermanentDeletionModal as openEditorRowPermanentDeletionModalFlow,
  openInsertEditorRowModal as openInsertEditorRowModalFlow,
  restoreEditorRow as restoreEditorRowFlow,
  softDeleteEditorRow as softDeleteEditorRowFlow,
  toggleDeletedEditorRowGroup as toggleDeletedEditorRowGroupFlow,
} from "./editor-row-structure-flow.js";
import {
  cloneRowFields,
  cloneRowFieldStates,
  hasActiveEditorField,
  hasEditorRow,
  hasEditorLanguage,
} from "./editor-utils.js";
import {
  ensureProjectNotTombstoned,
  findChapterContextById,
  selectedProjectsTeam,
} from "./project-chapter-flow.js";
import { invoke, waitForNextPaint } from "./runtime.js";
import { saveStoredEditorFontSizePx } from "./editor-preferences.js";
import {
  coerceEditorFontSizePx,
  createEditorChapterFilterState,
  createEditorChapterGlossaryState,
  createEditorReplaceUndoModalState,
  createEditorReplaceState,
  createEditorHistoryState,
  createEditorInsertRowModalState,
  createEditorRowPermanentDeletionModalState,
  createTargetLanguageManagerState,
  state,
} from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import {
  captureVisibleTranslateLocation,
  queueTranslateRowAnchor,
  restoreTranslateRowAnchor,
} from "./scroll-state.js";
import {
  invalidateEditorVirtualizationLayout,
  refreshEditorVirtualizationLayout,
  syncEditorVirtualizationRowLayout,
} from "./editor-virtualization.js";

export const MANAGE_TARGET_LANGUAGES_OPTION_VALUE = "__manage_target_languages__";

function normalizeEditorChapterFilters(filters) {
  return normalizeEditorChapterFilterState(filters);
}

function cloneCollapsedLanguageCodes(collapsedLanguageCodes) {
  return collapsedLanguageCodes instanceof Set
    ? new Set(collapsedLanguageCodes)
    : new Set();
}

function cloneExpandedDeletedRowGroupIds(expandedDeletedRowGroupIds) {
  return expandedDeletedRowGroupIds instanceof Set
    ? new Set(expandedDeletedRowGroupIds)
    : new Set();
}

function applyEditorUiState(nextEditorChapter, previousEditorChapter = state.editorChapter) {
  const isSameChapter = previousEditorChapter?.chapterId === nextEditorChapter?.chapterId;
  const activeRowId =
    typeof previousEditorChapter?.activeRowId === "string" ? previousEditorChapter.activeRowId : null;
  const activeLanguageCode =
    typeof previousEditorChapter?.activeLanguageCode === "string"
      ? previousEditorChapter.activeLanguageCode
      : null;
  const history = currentEditorHistoryForSelection(
    previousEditorChapter,
    activeRowId,
    activeLanguageCode,
  );

  return {
    ...nextEditorChapter,
    fontSizePx: coerceEditorFontSizePx(previousEditorChapter?.fontSizePx),
    collapsedLanguageCodes: cloneCollapsedLanguageCodes(previousEditorChapter?.collapsedLanguageCodes),
    dirtyRowIds: isSameChapter
      ? compactDirtyRowIds(nextEditorChapter?.rows, previousEditorChapter?.dirtyRowIds)
      : new Set(),
    filters: isSameChapter
      ? normalizeEditorChapterFilters(previousEditorChapter?.filters)
      : createEditorChapterFilterState(),
    replace: isSameChapter
      ? normalizeEditorReplaceState(previousEditorChapter?.replace)
      : createEditorReplaceState(),
    expandedDeletedRowGroupIds: cloneExpandedDeletedRowGroupIds(previousEditorChapter?.expandedDeletedRowGroupIds),
    glossary: nextEditorChapter?.glossary ?? previousEditorChapter?.glossary ?? createEditorChapterGlossaryState(),
    insertRowModal:
      previousEditorChapter?.insertRowModal?.isOpen === true
        && hasEditorRow(nextEditorChapter, previousEditorChapter.insertRowModal.rowId)
        ? { ...createEditorInsertRowModalState(), ...previousEditorChapter.insertRowModal }
        : createEditorInsertRowModalState(),
    rowPermanentDeletionModal:
      previousEditorChapter?.rowPermanentDeletionModal?.isOpen === true
        && hasEditorRow(nextEditorChapter, previousEditorChapter.rowPermanentDeletionModal.rowId)
        ? {
          ...createEditorRowPermanentDeletionModalState(),
          ...previousEditorChapter.rowPermanentDeletionModal,
        }
        : createEditorRowPermanentDeletionModalState(),
    replaceUndoModal:
      isSameChapter && previousEditorChapter?.replaceUndoModal?.isOpen === true
        ? {
          ...createEditorReplaceUndoModalState(),
          ...previousEditorChapter.replaceUndoModal,
        }
        : createEditorReplaceUndoModalState(),
    activeRowId:
      hasEditorRow(nextEditorChapter, activeRowId) && hasEditorLanguage(nextEditorChapter, activeLanguageCode)
        ? activeRowId
        : null,
    activeLanguageCode:
      hasEditorRow(nextEditorChapter, activeRowId) && hasEditorLanguage(nextEditorChapter, activeLanguageCode)
        ? activeLanguageCode
        : null,
    history:
      hasEditorRow(nextEditorChapter, activeRowId) && hasEditorLanguage(nextEditorChapter, activeLanguageCode)
        ? history
        : createEditorHistoryState(),
  };
}

function normalizeEditorRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const fields = cloneRowFields(row?.fields);
    const fieldStates = cloneRowFieldStates(row?.fieldStates);
    return {
      ...row,
      lifecycleState: row?.lifecycleState === "deleted" ? "deleted" : "active",
      orderKey: typeof row?.orderKey === "string" ? row.orderKey : "",
      fields,
      persistedFields: cloneRowFields(fields),
      fieldStates,
      persistedFieldStates: cloneRowFieldStates(fieldStates),
      saveStatus: "idle",
      saveError: "",
      markerSaveState: {
        status: "idle",
        languageCode: null,
        kind: null,
        error: "",
      },
    };
  });
}

export function resolveChapterSourceWordCount(chapter) {
  if (!chapter || typeof chapter !== "object") {
    return 0;
  }

  const sourceCode = chapter.selectedSourceLanguageCode;
  const counts =
    chapter.sourceWordCounts && typeof chapter.sourceWordCounts === "object"
      ? chapter.sourceWordCounts
      : {};
  const value = sourceCode ? counts[sourceCode] : null;
  return Number.isFinite(value) ? value : 0;
}

function persistProjectsForSelectedTeam() {
  const team = selectedProjectsTeam();
  if (!team) {
    return;
  }

  saveStoredProjectsForTeam(team, {
    projects: state.projects,
    deletedProjects: state.deletedProjects,
  });
}

function applyChapterMetadataToState(chapterId, updates) {
  if (!chapterId || !updates || typeof updates !== "object") {
    return;
  }

  const applyToProject = (project) => {
    if (!project || !Array.isArray(project.chapters)) {
      return project;
    }

    let changed = false;
    const chapters = project.chapters.map((chapter) => {
      if (!chapter || chapter.id !== chapterId) {
        return chapter;
      }

      changed = true;
      const nextChapter = {
        ...chapter,
        ...updates,
      };
      nextChapter.sourceWordCount = resolveChapterSourceWordCount(nextChapter);
      return nextChapter;
    });

    return changed ? { ...project, chapters } : project;
  };

  state.projects = state.projects.map(applyToProject);
  state.deletedProjects = state.deletedProjects.map(applyToProject);
  persistProjectsForSelectedTeam();
}

function updateEditorChapterRow(rowId, updater) {
  if (!state.editorChapter?.chapterId || !Array.isArray(state.editorChapter.rows)) {
    return null;
  }

  let updatedRow = null;
  const nextRows = state.editorChapter.rows.map((row) => {
    if (!row || row.rowId !== rowId) {
      return row;
    }

    updatedRow = updater(row);
    return updatedRow;
  });

  if (!updatedRow) {
    return null;
  }

  state.editorChapter = {
    ...state.editorChapter,
    rows: nextRows,
  };

  return updatedRow;
}

function insertEditorChapterRow(nextRow, anchorRowId, insertBefore = true) {
  if (!state.editorChapter?.chapterId || !Array.isArray(state.editorChapter.rows) || !nextRow?.rowId) {
    return;
  }

  const normalizedRow = normalizeEditorRows([nextRow])[0];
  const anchorIndex = state.editorChapter.rows.findIndex((row) => row?.rowId === anchorRowId);
  const rows = [...state.editorChapter.rows];
  const insertIndex = anchorIndex < 0
    ? rows.length
    : insertBefore
      ? anchorIndex
      : anchorIndex + 1;
  rows.splice(insertIndex, 0, normalizedRow);
  state.editorChapter = {
    ...state.editorChapter,
    rows,
  };
}

function removeEditorChapterRow(rowId) {
  if (!state.editorChapter?.chapterId || !Array.isArray(state.editorChapter.rows)) {
    return;
  }

  const rows = state.editorChapter.rows.filter((row) => row?.rowId !== rowId);
  state.editorChapter = {
    ...state.editorChapter,
    rows,
    dirtyRowIds: compactDirtyRowIds(rows, state.editorChapter.dirtyRowIds),
    activeRowId: state.editorChapter.activeRowId === rowId ? null : state.editorChapter.activeRowId,
    activeLanguageCode: state.editorChapter.activeRowId === rowId ? null : state.editorChapter.activeLanguageCode,
    history: state.editorChapter.activeRowId === rowId ? createEditorHistoryState() : state.editorChapter.history,
  };
}

function scheduleStructuralEditorScrollRestore(anchor) {
  if (!anchor?.rowId) {
    return;
  }

  const restorePass = () => {
    queueTranslateRowAnchor(anchor);
    refreshEditorVirtualizationLayout();
    restoreTranslateRowAnchor(anchor);
  };

  void waitForNextPaint().then(() => {
    restorePass();
    void waitForNextPaint().then(() => {
      restorePass();
    });
  });
}

function applyStructuralEditorChange(render, updateState, options = {}) {
  const anchor = options.anchorSnapshot ?? captureVisibleTranslateLocation();
  updateState();
  if (anchor) {
    queueTranslateRowAnchor(anchor);
  }
  invalidateEditorVirtualizationLayout(state.editorChapter?.chapterId);
  render?.();
  scheduleStructuralEditorScrollRestore(anchor);
  if (options.reloadHistory === true && hasActiveEditorField(state.editorChapter)) {
    loadActiveEditorFieldHistory(render);
  }
}

function rowsWithEditorRowLifecycleState(rows, rowId, lifecycleState) {
  return normalizeEditorRows(
    (Array.isArray(rows) ? rows : []).map((row) =>
      row?.rowId === rowId
        ? {
          ...row,
          lifecycleState,
        }
        : row
    ),
  );
}

function markEditorRowsPersisted(rowUpdates, sourceWordCounts = null) {
  const updatesByRowId = new Map(
    (Array.isArray(rowUpdates) ? rowUpdates : []).map((row) => [row.rowId, cloneRowFields(row.fields)]),
  );
  if (updatesByRowId.size === 0 || !state.editorChapter?.chapterId) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    rows: state.editorChapter.rows.map((row) => {
      if (!updatesByRowId.has(row.rowId)) {
        return row;
      }

      const fields = updatesByRowId.get(row.rowId);
      return {
        ...row,
        fields,
        persistedFields: cloneRowFields(fields),
        saveStatus: "idle",
        saveError: "",
      };
    }),
    sourceWordCounts:
      sourceWordCounts && typeof sourceWordCounts === "object"
        ? sourceWordCounts
        : state.editorChapter.sourceWordCounts,
  };
  reconcileDirtyTrackedEditorRows([...updatesByRowId.keys()]);
  applyEditorSelectionsToProjectState(state.editorChapter);
}

export function openEditorReplaceUndoModal(commitSha) {
  openEditorReplaceUndoModalFlow(commitSha);
}

export function cancelEditorReplaceUndoModal() {
  cancelEditorReplaceUndoModalFlow();
}

export function syncEditorGlossaryHighlightRowDom(
  rowId,
  chapterState = state.editorChapter,
  root = document,
) {
  syncEditorGlossaryHighlightRowDomFlow(rowId, chapterState, root);
}

export function restoreMountedEditorGlossaryHighlightsFromCache(
  root = document,
  chapterState = state.editorChapter,
) {
  restoreMountedEditorGlossaryHighlightsFromCacheFlow(root, chapterState);
}

export function syncVisibleEditorGlossaryHighlightRows(
  root = document,
  scrollContainer = root?.querySelector?.(".translate-main-scroll") ?? null,
  chapterState = state.editorChapter,
) {
  syncVisibleEditorGlossaryHighlightRowsFlow(root, scrollContainer, chapterState);
}

function applyEditorPayloadToState(payload, projectId, existingChapter = {}, glossaryState = null) {
  const previousEditorChapter = state.editorChapter;
  const { selectedSourceLanguageCode, selectedTargetLanguageCode } = normalizeLanguageSelections(
    payload.languages,
    existingChapter.selectedSourceLanguageCode ?? payload.selectedSourceLanguageCode,
    existingChapter.selectedTargetLanguageCode ?? payload.selectedTargetLanguageCode,
  );

  state.editorChapter = applyEditorUiState({
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
    rows: normalizeEditorRows(payload.rows),
  }, previousEditorChapter);

  applyChapterMetadataToState(payload.chapterId, {
    name: payload.fileTitle,
    languages: state.editorChapter.languages,
    sourceWordCounts: state.editorChapter.sourceWordCounts,
    selectedSourceLanguageCode,
    selectedTargetLanguageCode,
  });
}

function applyEditorSelectionsToProjectState(chapterState = state.editorChapter) {
  if (!chapterState?.chapterId) {
    return;
  }

  applyChapterMetadataToState(chapterState.chapterId, {
    name: chapterState.fileTitle,
    languages: chapterState.languages,
    sourceWordCounts: chapterState.sourceWordCounts,
    selectedSourceLanguageCode: chapterState.selectedSourceLanguageCode,
    selectedTargetLanguageCode: chapterState.selectedTargetLanguageCode,
  });
}

export function loadActiveEditorFieldHistory(render) {
  loadActiveEditorFieldHistoryFlow(render);
}

export function setActiveEditorField(render, rowId, languageCode) {
  setActiveEditorFieldFlow(render, rowId, languageCode);
}

function editorPersistenceOperations() {
  return {
    updateEditorChapterRow,
    applyEditorSelectionsToProjectState,
  };
}

function editorRowStructureOperations() {
  return {
    updateEditorChapterRow,
    insertEditorChapterRow,
    removeEditorChapterRow,
    applyStructuralEditorChange,
    rowsWithEditorRowLifecycleState,
    applyEditorSelectionsToProjectState,
  };
}

export function scheduleDirtyEditorRowScan(render, rowId) {
  scheduleDirtyEditorRowScanFlow(render, rowId, editorPersistenceOperations());
}

export async function flushDirtyEditorRows(render, options = {}) {
  return flushDirtyEditorRowsFlow(render, editorPersistenceOperations(), options);
}

export function toggleEditorHistoryGroupExpanded(groupKey) {
  toggleEditorHistoryGroupExpandedFlow(groupKey);
}

export async function persistEditorChapterSelections(render) {
  await persistEditorChapterSelectionsFlow(render, {
    applyChapterMetadataToState,
    applyEditorSelectionsToProjectState,
  });
}

export async function loadSelectedChapterEditorData(render, options = {}) {
  const team = selectedProjectsTeam();
  const context = findChapterContextById();
  if (!context || !Number.isFinite(team?.installationId)) {
    state.editorChapter = {
      ...state.editorChapter,
      status: "error",
      error: "Could not determine which file to open.",
    };
    render();
    return;
  }
  if (await ensureProjectNotTombstoned(render, team, context.project)) {
    state.editorChapter = {
      ...state.editorChapter,
      status: "error",
      error: "This project was permanently deleted.",
      rows: [],
    };
    render();
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
  render();

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
    applyEditorPayloadToState(payload, context.project.id, context.chapter, glossaryState);
    render();
    if (hasActiveEditorField(state.editorChapter)) {
      loadActiveEditorFieldHistory(render);
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
    render();
  }
}

export async function openTranslateChapter(render, chapterId) {
  const context = findChapterContextById(chapterId);
  if (!context) {
    showNoticeBadge("Could not determine which file to open.", render);
    return;
  }

  if (!(await flushDirtyEditorRows(render))) {
    showNoticeBadge("Finish saving the current row before opening a different file.", render);
    return;
  }

  void persistEditorChapterSelections(render);
  state.selectedProjectId = context.project.id;
  state.selectedChapterId = chapterId;
  state.screen = "translate";
  await loadSelectedChapterEditorData(render);
}

export function updateEditorSourceLanguage(render, nextCode) {
  updateEditorSourceLanguageFlow(render, nextCode, {
    applyChapterMetadataToState,
    applyEditorSelectionsToProjectState,
  });
}

export function updateEditorTargetLanguage(render, nextCode) {
  updateEditorTargetLanguageFlow(render, nextCode, {
    applyChapterMetadataToState,
    applyEditorSelectionsToProjectState,
  });
}

export function updateEditorFontSize(nextValue) {
  const fontSizePx = coerceEditorFontSizePx(nextValue);
  state.editorChapter = {
    ...state.editorChapter,
    fontSizePx,
  };
  saveStoredEditorFontSizePx(fontSizePx);
}

export async function restoreEditorFieldHistory(render, commitSha) {
  await restoreEditorFieldHistoryFlow(render, commitSha, {
    updateEditorChapterRow,
    reconcileDirtyTrackedEditorRows,
    applyEditorSelectionsToProjectState,
  });
}

export async function confirmEditorReplaceUndo(render) {
  await confirmEditorReplaceUndoFlow(render, {
    markEditorRowsPersisted,
  });
}

export function openTargetLanguageManager() {
  state.targetLanguageManager = {
    ...state.targetLanguageManager,
    isOpen: true,
    status: "idle",
    error: "",
  };
}

export function closeTargetLanguageManager() {
  state.targetLanguageManager = createTargetLanguageManagerState();
}

export function openInsertEditorRowModal(rowId) {
  openInsertEditorRowModalFlow(rowId);
}

export function cancelInsertEditorRowModal() {
  cancelInsertEditorRowModalFlow();
}

export function openEditorRowPermanentDeletionModal(rowId) {
  openEditorRowPermanentDeletionModalFlow(rowId);
}

export function cancelEditorRowPermanentDeletionModal() {
  cancelEditorRowPermanentDeletionModalFlow();
}

export function toggleDeletedEditorRowGroup(render, groupId, anchorSnapshot = null) {
  toggleDeletedEditorRowGroupFlow(render, groupId, anchorSnapshot, editorRowStructureOperations());
}

export async function confirmInsertEditorRow(render, position) {
  await confirmInsertEditorRowFlow(render, position, editorRowStructureOperations());
}

export async function softDeleteEditorRow(render, rowId, triggerAnchorSnapshot = null) {
  await softDeleteEditorRowFlow(render, rowId, triggerAnchorSnapshot, editorRowStructureOperations());
}

export async function restoreEditorRow(render, rowId) {
  await restoreEditorRowFlow(render, rowId, editorRowStructureOperations());
}

export async function confirmEditorRowPermanentDeletion(render) {
  await confirmEditorRowPermanentDeletionFlow(render, editorRowStructureOperations());
}

export function updateEditorRowFieldValue(rowId, languageCode, nextValue) {
  updateEditorRowFieldValueFlow(rowId, languageCode, nextValue, {
    updateEditorChapterRow,
  });
}

export function updateEditorSearchFilterQuery(render, nextValue) {
  updateEditorSearchFilterQueryFlow(render, nextValue);
}

export function toggleEditorSearchFilterCaseSensitive(render, enabled) {
  toggleEditorSearchFilterCaseSensitiveFlow(render, enabled);
}

export function toggleEditorReplaceEnabled(render, enabled, anchorTarget = null) {
  toggleEditorReplaceEnabledFlow(render, enabled, anchorTarget);
}

export function updateEditorReplaceQuery(render, nextValue) {
  updateEditorReplaceQueryFlow(render, nextValue);
}

export function toggleEditorReplaceRowSelected(render, rowId, selected, anchorTarget = null) {
  toggleEditorReplaceRowSelectedFlow(render, rowId, selected, anchorTarget);
}

export function selectAllEditorReplaceRows(render) {
  selectAllEditorReplaceRowsFlow(render);
}

export async function replaceSelectedEditorRows(render) {
  await replaceSelectedEditorRowsFlow(render, {
    markEditorRowsPersisted,
    loadActiveEditorFieldHistory,
  });
}

export async function toggleEditorRowFieldMarker(render, rowId, languageCode, kind) {
  await toggleEditorRowFieldMarkerFlow(render, rowId, languageCode, kind, {
    updateEditorChapterRow,
  });
}

export function toggleEditorLanguageCollapsed(languageCode) {
  if (!languageCode) {
    return;
  }

  const collapsedLanguageCodes =
    state.editorChapter?.collapsedLanguageCodes instanceof Set
      ? new Set(state.editorChapter.collapsedLanguageCodes)
      : new Set();

  if (collapsedLanguageCodes.has(languageCode)) {
    collapsedLanguageCodes.delete(languageCode);
  } else {
    collapsedLanguageCodes.add(languageCode);
  }

  state.editorChapter = {
    ...state.editorChapter,
    collapsedLanguageCodes,
  };
}

export async function persistEditorRowOnBlur(render, rowId) {
  await persistEditorRowOnBlurFlow(render, rowId, editorPersistenceOperations());
}
