import { saveStoredProjectsForTeam } from "./project-cache.js";
import {
  buildEditorGlossaryModel,
  buildEditorRowGlossaryHighlights,
} from "./editor-glossary-highlighting.js";
import {
  buildEditorRowSearchHighlights,
  mergeEditorTextHighlightMaps,
} from "./editor-search-highlighting.js";
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
  rowFieldsEqual,
} from "./editor-row-persistence-model.js";
import {
  buildEditorBatchReplaceUpdates,
  buildEditorReplaceCommitMessage,
  buildEditorReplaceResetCommitMessage,
  cloneEditorReplaceSelectedRowIds,
  currentMatchingEditorReplaceRowIds,
  formatReplaceRowCount,
  normalizeEditorReplaceState,
  selectedMatchingEditorReplaceRowIds,
  updateEditorReplaceState,
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
  deletedRowGroupIdAfterSoftDelete,
  expandedDeletedRowGroupIdsAfterPermanentDelete,
  expandedDeletedRowGroupIdsAfterRestore,
  expandedDeletedRowGroupIdsAfterSoftDelete,
} from "./editor-deleted-rows.js";
import {
  buildVisibleEditorLanguageCodeSet,
  cloneRowFields,
  cloneRowFieldStates,
  findEditorRowById,
  hasActiveEditorField,
  hasEditorRow,
  hasEditorLanguage,
  normalizeFieldState,
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
import { canPermanentlyDeleteProjectFiles } from "./resource-capabilities.js";
import {
  captureTranslateRowAnchor,
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
const EDITOR_GLOSSARY_HIGHLIGHT_CACHE_LIMIT = 400;

let editorGlossaryHighlightCacheContextKey = "";
let editorGlossaryHighlightCacheMatcherModel = null;
const editorGlossaryHighlightCache = new Map();

function normalizeLanguageSelections(languages, sourceCode, targetCode) {
  const options = Array.isArray(languages) ? languages : [];
  const codes = new Set(options.map((language) => language.code).filter(Boolean));
  const fallbackSource =
    options.find((language) => language.role === "source")?.code ?? options[0]?.code ?? null;
  const nextSource = codes.has(sourceCode) ? sourceCode : fallbackSource;
  const fallbackTarget =
    options.find((language) => language.code !== nextSource && language.role === "target")?.code
    ?? options.find((language) => language.code !== nextSource)?.code
    ?? nextSource
    ?? null;
  const nextTarget =
    targetCode && codes.has(targetCode) && targetCode !== nextSource ? targetCode : fallbackTarget;

  return {
    selectedSourceLanguageCode: nextSource,
    selectedTargetLanguageCode: nextTarget,
  };
}

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

function normalizeEditorGlossaryLink(link) {
  if (!link || typeof link !== "object") {
    return null;
  }

  const glossaryId =
    typeof link.glossaryId === "string" && link.glossaryId.trim()
      ? link.glossaryId.trim()
      : null;
  const repoName =
    typeof link.repoName === "string" && link.repoName.trim()
      ? link.repoName.trim()
      : null;
  if (!glossaryId || !repoName) {
    return null;
  }

  return {
    glossaryId,
    repoName,
  };
}

function editorGlossaryStateMatchesLink(glossaryState, linkedGlossary) {
  const normalizedLink = normalizeEditorGlossaryLink(linkedGlossary);
  if (!normalizedLink) {
    return false;
  }

  return (
    glossaryState?.glossaryId === normalizedLink.glossaryId
    && glossaryState?.repoName === normalizedLink.repoName
  );
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

function buildEditorGlossaryStateFromPayload(payload, linkedGlossary) {
  const normalizedLink = normalizeEditorGlossaryLink(linkedGlossary);
  if (!normalizedLink) {
    return createEditorChapterGlossaryState();
  }

  const normalizedTerms = (Array.isArray(payload?.terms) ? payload.terms : [])
    .filter((term) => term?.lifecycleState !== "deleted");
  const glossaryState = {
    status: "ready",
    error: "",
    glossaryId: payload?.glossaryId ?? normalizedLink.glossaryId,
    repoName: normalizedLink.repoName,
    title: payload?.title ?? "",
    sourceLanguage: payload?.sourceLanguage ?? null,
    targetLanguage: payload?.targetLanguage ?? null,
    terms: normalizedTerms,
    matcherModel: null,
  };
  glossaryState.matcherModel = buildEditorGlossaryModel(glossaryState);
  return glossaryState;
}

async function loadEditorGlossaryState(team, chapter) {
  const linkedGlossary = normalizeEditorGlossaryLink(chapter?.linkedGlossary);
  if (!linkedGlossary || !Number.isFinite(team?.installationId)) {
    return createEditorChapterGlossaryState();
  }

  try {
    const payload = await invoke("load_gtms_glossary_editor_data", {
      input: {
        installationId: team.installationId,
        glossaryId: linkedGlossary.glossaryId,
        repoName: linkedGlossary.repoName,
      },
    });
    return buildEditorGlossaryStateFromPayload(payload, linkedGlossary);
  } catch (error) {
    return {
      ...createEditorChapterGlossaryState(),
      status: "error",
      error: error?.message ?? String(error),
      glossaryId: linkedGlossary.glossaryId,
      repoName: linkedGlossary.repoName,
    };
  }
}

function buildEditorRowSections(row, chapterState = state.editorChapter) {
  return (Array.isArray(chapterState?.languages) ? chapterState.languages : []).map((language) => ({
    code: language.code,
    text: row?.fields?.[language.code] ?? "",
  }));
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

async function commitEditorRowFieldsBatch({
  installationId,
  projectId,
  repoName,
  chapterId,
  rows,
  commitMessage,
  operation,
}) {
  return invoke("update_gtms_editor_row_fields_batch", {
    input: {
      installationId,
      projectId,
      repoName,
      chapterId,
      rows,
      commitMessage,
      operation,
    },
  });
}

export function openEditorReplaceUndoModal(commitSha) {
  openEditorReplaceUndoModalFlow(commitSha);
}

export function cancelEditorReplaceUndoModal() {
  cancelEditorReplaceUndoModalFlow();
}

function editorGlossaryHighlightContextKey(chapterState = state.editorChapter) {
  const glossaryId = chapterState?.glossary?.glossaryId ?? "";
  const repoName = chapterState?.glossary?.repoName ?? "";
  return `${chapterState?.chapterId ?? ""}::${glossaryId}::${repoName}`;
}

function synchronizeEditorGlossaryHighlightCache(chapterState = state.editorChapter) {
  const nextContextKey = editorGlossaryHighlightContextKey(chapterState);
  const nextMatcherModel = chapterState?.glossary?.matcherModel ?? null;
  if (
    nextContextKey === editorGlossaryHighlightCacheContextKey
    && nextMatcherModel === editorGlossaryHighlightCacheMatcherModel
  ) {
    return;
  }

  editorGlossaryHighlightCacheContextKey = nextContextKey;
  editorGlossaryHighlightCacheMatcherModel = nextMatcherModel;
  editorGlossaryHighlightCache.clear();
}

function buildEditorRowGlossaryHighlightCacheKey(row, chapterState = state.editorChapter) {
  const glossaryModel = chapterState?.glossary?.matcherModel ?? null;
  const rowId = typeof row?.rowId === "string" && row.rowId.trim() ? row.rowId.trim() : "";
  if (!rowId || !glossaryModel?.sourceLanguage?.code) {
    return "";
  }

  const sourceCode = glossaryModel.sourceLanguage.code;
  const targetCode = glossaryModel.targetLanguage?.code ?? "";
  const sourceText = String(row?.fields?.[sourceCode] ?? "");
  const targetText = targetCode ? String(row?.fields?.[targetCode] ?? "") : "";
  return `${rowId}::${sourceCode}:${sourceText}::${targetCode}:${targetText}`;
}

function cacheEditorGlossaryHighlightResult(cacheKey, highlightMap) {
  if (!cacheKey) {
    return;
  }

  editorGlossaryHighlightCache.set(cacheKey, highlightMap);
  if (editorGlossaryHighlightCache.size <= EDITOR_GLOSSARY_HIGHLIGHT_CACHE_LIMIT) {
    return;
  }

  const oldestKey = editorGlossaryHighlightCache.keys().next().value;
  if (oldestKey) {
    editorGlossaryHighlightCache.delete(oldestKey);
  }
}

function buildCachedEditorRowGlossaryHighlights(row, chapterState = state.editorChapter) {
  synchronizeEditorGlossaryHighlightCache(chapterState);

  const glossaryModel = chapterState?.glossary?.matcherModel ?? null;
  if (!glossaryModel) {
    return new Map();
  }

  const cacheKey = buildEditorRowGlossaryHighlightCacheKey(row, chapterState);
  if (cacheKey && editorGlossaryHighlightCache.has(cacheKey)) {
    return editorGlossaryHighlightCache.get(cacheKey);
  }

  const highlightMap = buildEditorRowGlossaryHighlights(
    buildEditorRowSections(row, chapterState),
    glossaryModel,
  );
  cacheEditorGlossaryHighlightResult(cacheKey, highlightMap);
  return highlightMap;
}

function buildEditorRowSearchHighlightMap(row, chapterState = state.editorChapter) {
  const filters = normalizeEditorChapterFilters(chapterState?.filters);
  const searchQuery = typeof filters?.searchQuery === "string" ? filters.searchQuery.trim() : "";
  if (!searchQuery) {
    return new Map();
  }

  return buildEditorRowSearchHighlights(
    buildEditorRowSections(row, chapterState),
    searchQuery,
    buildVisibleEditorLanguageCodeSet(chapterState),
    { caseSensitive: filters.caseSensitive === true },
  );
}

function readCachedEditorRowGlossaryHighlights(row, chapterState = state.editorChapter) {
  synchronizeEditorGlossaryHighlightCache(chapterState);

  const glossaryModel = chapterState?.glossary?.matcherModel ?? null;
  if (!glossaryModel) {
    return null;
  }

  const cacheKey = buildEditorRowGlossaryHighlightCacheKey(row, chapterState);
  if (!cacheKey || !editorGlossaryHighlightCache.has(cacheKey)) {
    return null;
  }

  return editorGlossaryHighlightCache.get(cacheKey) ?? null;
}

function applyEditorTextHighlightMapToRowCard(rowCard, highlightMap) {
  rowCard.querySelectorAll("[data-editor-glossary-field-stack]").forEach((stack) => {
    if (!(stack instanceof HTMLElement)) {
      return;
    }

    const languageCode = stack.dataset.languageCode ?? "";
    const highlight = highlightMap.get(languageCode) ?? null;
    const highlightHtml = typeof highlight?.html === "string" ? highlight.html : "";
    const hasRenderableHighlight = highlight?.hasMatches === true && highlightHtml.length > 0;
    const highlightKind = highlight?.kind === "search" ? "search" : "glossary";
    stack.classList.toggle(
      "translation-language-panel__field-stack--highlighted",
      hasRenderableHighlight,
    );
    stack.classList.toggle(
      "translation-language-panel__field-stack--glossary",
      hasRenderableHighlight && highlightKind === "glossary",
    );
    stack.classList.toggle(
      "translation-language-panel__field-stack--search",
      hasRenderableHighlight && highlightKind === "search",
    );
    const layer = stack.querySelector("[data-editor-glossary-highlight]");
    if (layer instanceof HTMLElement) {
      layer.innerHTML = hasRenderableHighlight ? highlightHtml : "";
    }
  });
}

function syncEditorGlossaryHighlightRowCard(rowCard, chapterState = state.editorChapter) {
  const rowId = rowCard?.dataset?.rowId ?? "";
  if (!(rowCard instanceof HTMLElement) || !rowId || !chapterState?.chapterId) {
    return;
  }

  const row = findEditorRowById(rowId, chapterState);
  if (!row) {
    return;
  }

  const glossaryHighlightMap = buildCachedEditorRowGlossaryHighlights(row, chapterState);
  const searchHighlightMap = buildEditorRowSearchHighlightMap(row, chapterState);
  const highlightMap = mergeEditorTextHighlightMaps(searchHighlightMap, glossaryHighlightMap);
  applyEditorTextHighlightMapToRowCard(rowCard, highlightMap);
}

function syncMountedEditorGlossaryHighlightRows(
  root = document,
  chapterState = state.editorChapter,
  options = {},
) {
  if (
    typeof document === "undefined"
    || typeof root?.querySelectorAll !== "function"
    || !chapterState?.chapterId
  ) {
    return;
  }

  const computeIfMissing = options.computeIfMissing !== false;
  const visibleContainer =
    options.visibleContainer instanceof HTMLElement ? options.visibleContainer : null;
  const containerRect = visibleContainer?.getBoundingClientRect?.() ?? null;

  root.querySelectorAll("[data-editor-row-card]").forEach((rowCard) => {
    if (!(rowCard instanceof HTMLElement)) {
      return;
    }

    if (containerRect) {
      const rowRect = rowCard.getBoundingClientRect();
      if (rowRect.bottom <= containerRect.top || rowRect.top >= containerRect.bottom) {
        return;
      }
    }

    const rowId = rowCard.dataset.rowId ?? "";
    if (!rowId) {
      return;
    }

    const row = findEditorRowById(rowId, chapterState);
    if (!row) {
      return;
    }

    const glossaryHighlightMap = computeIfMissing
      ? buildCachedEditorRowGlossaryHighlights(row, chapterState)
      : readCachedEditorRowGlossaryHighlights(row, chapterState);
    const searchHighlightMap = buildEditorRowSearchHighlightMap(row, chapterState);
    const highlightMap = mergeEditorTextHighlightMaps(searchHighlightMap, glossaryHighlightMap);
    applyEditorTextHighlightMapToRowCard(rowCard, highlightMap);
  });
}

export function syncEditorGlossaryHighlightRowDom(
  rowId,
  chapterState = state.editorChapter,
  root = document,
) {
  if (typeof document === "undefined" || !rowId || !chapterState?.chapterId) {
    return;
  }

  const rowCard = root.querySelector(
    `[data-editor-row-card][data-row-id="${CSS.escape(rowId)}"]`,
  );
  if (!(rowCard instanceof HTMLElement)) {
    return;
  }

  syncEditorGlossaryHighlightRowCard(rowCard, chapterState);
}

export function restoreMountedEditorGlossaryHighlightsFromCache(
  root = document,
  chapterState = state.editorChapter,
) {
  syncMountedEditorGlossaryHighlightRows(root, chapterState, {
    computeIfMissing: false,
  });
}

export function syncVisibleEditorGlossaryHighlightRows(
  root = document,
  scrollContainer = root?.querySelector?.(".translate-main-scroll") ?? null,
  chapterState = state.editorChapter,
) {
  if (!(scrollContainer instanceof HTMLElement)) {
    return;
  }

  syncMountedEditorGlossaryHighlightRows(root, chapterState, {
    computeIfMissing: true,
    visibleContainer: scrollContainer,
  });
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

function setEditorSelections(nextSelections) {
  state.editorChapter = {
    ...state.editorChapter,
    ...nextSelections,
  };
  applyEditorSelectionsToProjectState(state.editorChapter);
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
  const editorChapter = state.editorChapter;
  if (!editorChapter?.chapterId) {
    return;
  }

  if (editorChapter.selectionPersistStatus === "saving") {
    state.editorChapter = {
      ...editorChapter,
      selectionPersistStatus: "dirty",
    };
    return;
  }

  const desiredSourceLanguageCode = editorChapter.selectedSourceLanguageCode;
  const desiredTargetLanguageCode = editorChapter.selectedTargetLanguageCode;
  if (!desiredSourceLanguageCode || !desiredTargetLanguageCode) {
    return;
  }

  const persistedSourceLanguageCode = editorChapter.persistedSourceLanguageCode;
  const persistedTargetLanguageCode = editorChapter.persistedTargetLanguageCode;
  if (
    desiredSourceLanguageCode === persistedSourceLanguageCode
    && desiredTargetLanguageCode === persistedTargetLanguageCode
  ) {
    if (editorChapter.selectionPersistStatus !== "idle") {
      state.editorChapter = {
        ...editorChapter,
        selectionPersistStatus: "idle",
      };
      render?.();
    }
    return;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    selectionPersistStatus: "saving",
  };

  try {
    const payload = await invoke("update_gtms_chapter_language_selection", {
      input: {
        installationId: team.installationId,
        projectId: context.project.id,
        repoName: context.project.name,
        chapterId: editorChapter.chapterId,
        sourceLanguageCode: desiredSourceLanguageCode,
        targetLanguageCode: desiredTargetLanguageCode,
      },
    });

    applyChapterMetadataToState(editorChapter.chapterId, {
      selectedSourceLanguageCode: payload.sourceLanguageCode,
      selectedTargetLanguageCode: payload.targetLanguageCode,
    });

    const shouldPersistAgain =
      state.editorChapter?.chapterId === editorChapter.chapterId
      && (
        state.editorChapter.selectionPersistStatus === "dirty"
        || state.editorChapter.selectedSourceLanguageCode !== payload.sourceLanguageCode
        || state.editorChapter.selectedTargetLanguageCode !== payload.targetLanguageCode
      );

    if (state.editorChapter?.chapterId === editorChapter.chapterId) {
      state.editorChapter = {
        ...state.editorChapter,
        persistedSourceLanguageCode: payload.sourceLanguageCode,
        persistedTargetLanguageCode: payload.targetLanguageCode,
        selectionPersistStatus: "idle",
      };
      render?.();
    }

    if (shouldPersistAgain) {
      void persistEditorChapterSelections(render);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (state.editorChapter?.chapterId === editorChapter.chapterId) {
      const restoredSelections = normalizeLanguageSelections(
        state.editorChapter.languages,
        persistedSourceLanguageCode,
        persistedTargetLanguageCode,
      );
      state.editorChapter = {
        ...state.editorChapter,
        ...restoredSelections,
        selectionPersistStatus: "idle",
      };
      applyEditorSelectionsToProjectState(state.editorChapter);
      render?.();
    }
    showNoticeBadge(message || "The language selection could not be saved.", render);
  }
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
  if (!nextCode || !Array.isArray(state.editorChapter.languages) || state.editorChapter.languages.length === 0) {
    return;
  }

  const selections = normalizeLanguageSelections(
    state.editorChapter.languages,
    nextCode,
    state.editorChapter.selectedTargetLanguageCode,
  );
  setEditorSelections(selections);
  render();
  void persistEditorChapterSelections(render);
}

export function updateEditorTargetLanguage(render, nextCode) {
  if (!nextCode || !Array.isArray(state.editorChapter.languages) || state.editorChapter.languages.length === 0) {
    return;
  }

  const selections = normalizeLanguageSelections(
    state.editorChapter.languages,
    state.editorChapter.selectedSourceLanguageCode,
    nextCode,
  );
  setEditorSelections(selections);
  render();
  void persistEditorChapterSelections(render);
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
  if (!rowId || !hasEditorRow(state.editorChapter, rowId)) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    insertRowModal: {
      ...createEditorInsertRowModalState(),
      isOpen: true,
      rowId,
    },
  };
}

export function cancelInsertEditorRowModal() {
  state.editorChapter = {
    ...state.editorChapter,
    insertRowModal: createEditorInsertRowModalState(),
  };
}

export function openEditorRowPermanentDeletionModal(rowId) {
  if (!rowId || !hasEditorRow(state.editorChapter, rowId)) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    rowPermanentDeletionModal: {
      ...createEditorRowPermanentDeletionModalState(),
      isOpen: true,
      rowId,
    },
  };
}

export function cancelEditorRowPermanentDeletionModal() {
  state.editorChapter = {
    ...state.editorChapter,
    rowPermanentDeletionModal: createEditorRowPermanentDeletionModalState(),
  };
}

export function toggleDeletedEditorRowGroup(render, groupId, anchorSnapshot = null) {
  if (!groupId || !state.editorChapter?.chapterId) {
    return;
  }

  applyStructuralEditorChange(render, () => {
    const expandedDeletedRowGroupIds = cloneExpandedDeletedRowGroupIds(
      state.editorChapter.expandedDeletedRowGroupIds,
    );
    if (expandedDeletedRowGroupIds.has(groupId)) {
      expandedDeletedRowGroupIds.delete(groupId);
    } else {
      expandedDeletedRowGroupIds.add(groupId);
    }
    state.editorChapter = {
      ...state.editorChapter,
      expandedDeletedRowGroupIds,
    };
  }, { anchorSnapshot });
}

export async function confirmInsertEditorRow(render, position) {
  const editorChapter = state.editorChapter;
  const modal = editorChapter?.insertRowModal;
  if (!editorChapter?.chapterId || !modal?.isOpen || !modal.rowId) {
    return;
  }
  if (position !== "before" && position !== "after") {
    return;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
    return;
  }

  state.editorChapter = {
    ...editorChapter,
    insertRowModal: {
      ...modal,
      status: "loading",
      error: "",
    },
  };
  render?.();

  try {
    const payload = await invoke(
      position === "before" ? "insert_gtms_editor_row_before" : "insert_gtms_editor_row_after",
      {
        input: {
          installationId: team.installationId,
          projectId: context.project.id,
          repoName: context.project.name,
          chapterId: editorChapter.chapterId,
          rowId: modal.rowId,
        },
      },
    );

    if (state.editorChapter?.chapterId !== editorChapter.chapterId) {
      return;
    }

    const insertedRowId = typeof payload?.row?.rowId === "string" ? payload.row.rowId : null;
    const insertAnchorSnapshot = insertedRowId
      ? {
        type: "row",
        rowId: insertedRowId,
        languageCode: null,
        offsetTop: 80,
      }
      : null;

    applyStructuralEditorChange(render, () => {
      insertEditorChapterRow(payload?.row, modal.rowId, position === "before");
      state.editorChapter = {
        ...state.editorChapter,
        sourceWordCounts:
          payload?.sourceWordCounts && typeof payload.sourceWordCounts === "object"
            ? payload.sourceWordCounts
            : state.editorChapter.sourceWordCounts,
        insertRowModal: createEditorInsertRowModalState(),
        activeRowId: payload?.row?.rowId ?? state.editorChapter.activeRowId,
        activeLanguageCode:
          state.editorChapter.activeLanguageCode
          ?? state.editorChapter.selectedTargetLanguageCode
          ?? state.editorChapter.selectedSourceLanguageCode
          ?? null,
      };
      applyEditorSelectionsToProjectState(state.editorChapter);
    }, {
      anchorSnapshot: insertAnchorSnapshot,
      reloadHistory: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (state.editorChapter?.chapterId === editorChapter.chapterId) {
      state.editorChapter = {
        ...state.editorChapter,
        insertRowModal: {
          ...state.editorChapter.insertRowModal,
          status: "idle",
          error: message,
        },
      };
      render?.();
    }
    showNoticeBadge(message || "The row could not be inserted.", render);
  }
}

export async function softDeleteEditorRow(render, rowId, triggerAnchorSnapshot = null) {
  const editorChapter = state.editorChapter;
  if (!editorChapter?.chapterId || !rowId) {
    return;
  }

  const row = findEditorRowById(rowId, editorChapter);
  if (!row || row.saveStatus !== "idle" || row.markerSaveState?.status === "saving") {
    showNoticeBadge("Save the current row before deleting it.", render);
    return;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
    return;
  }

  try {
    const payload = await invoke("soft_delete_gtms_editor_row", {
      input: {
        installationId: team.installationId,
        projectId: context.project.id,
        repoName: context.project.name,
        chapterId: editorChapter.chapterId,
        rowId,
      },
    });

    if (state.editorChapter?.chapterId !== editorChapter.chapterId) {
      return;
    }

    const previousRows = state.editorChapter.rows;
    const nextRows = rowsWithEditorRowLifecycleState(previousRows, rowId, payload?.lifecycleState ?? "deleted");
    const expandedDeletedRowGroupIds = expandedDeletedRowGroupIdsAfterSoftDelete(
      previousRows,
      rowId,
      state.editorChapter.expandedDeletedRowGroupIds,
      nextRows,
    );
    const nextDeletedGroupId = deletedRowGroupIdAfterSoftDelete(previousRows, rowId);
    const nextDeletedGroupIsOpen =
      typeof nextDeletedGroupId === "string" && expandedDeletedRowGroupIds.has(nextDeletedGroupId);
    const anchorSnapshot = nextDeletedGroupId && !nextDeletedGroupIsOpen
      ? {
        type: "deleted-group",
        rowId: `deleted-group:${nextDeletedGroupId}`,
        languageCode: null,
        offsetTop: Number.isFinite(Number(triggerAnchorSnapshot?.offsetTop))
          ? Number(triggerAnchorSnapshot.offsetTop)
          : 80,
      }
      : {
        type: "row",
        rowId,
        languageCode: null,
        offsetTop: Number.isFinite(Number(triggerAnchorSnapshot?.offsetTop))
          ? Number(triggerAnchorSnapshot.offsetTop)
          : 80,
      };
    applyStructuralEditorChange(render, () => {
      updateEditorChapterRow(rowId, (currentRow) => ({
        ...currentRow,
        lifecycleState: payload?.lifecycleState ?? "deleted",
      }));
      state.editorChapter = {
        ...state.editorChapter,
        expandedDeletedRowGroupIds,
        sourceWordCounts:
          payload?.sourceWordCounts && typeof payload.sourceWordCounts === "object"
            ? payload.sourceWordCounts
            : state.editorChapter.sourceWordCounts,
        activeRowId: state.editorChapter.activeRowId === rowId ? null : state.editorChapter.activeRowId,
        activeLanguageCode:
          state.editorChapter.activeRowId === rowId ? null : state.editorChapter.activeLanguageCode,
        history:
          state.editorChapter.activeRowId === rowId
            ? createEditorHistoryState()
            : state.editorChapter.history,
      };
      applyEditorSelectionsToProjectState(state.editorChapter);
    }, {
      anchorSnapshot,
    });
    showNoticeBadge("Row deleted.", render);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showNoticeBadge(message || "The row could not be deleted.", render);
  }
}

export async function restoreEditorRow(render, rowId) {
  const editorChapter = state.editorChapter;
  if (!editorChapter?.chapterId || !rowId) {
    return;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
    return;
  }

  try {
    const payload = await invoke("restore_gtms_editor_row", {
      input: {
        installationId: team.installationId,
        projectId: context.project.id,
        repoName: context.project.name,
        chapterId: editorChapter.chapterId,
        rowId,
      },
    });

    if (state.editorChapter?.chapterId !== editorChapter.chapterId) {
      return;
    }

    applyStructuralEditorChange(render, () => {
      const previousRows = state.editorChapter.rows;
      updateEditorChapterRow(rowId, (currentRow) => ({
        ...currentRow,
        lifecycleState: payload?.lifecycleState ?? "active",
      }));
      const expandedDeletedRowGroupIds = expandedDeletedRowGroupIdsAfterRestore(
        previousRows,
        rowId,
        state.editorChapter.expandedDeletedRowGroupIds,
        state.editorChapter.rows,
      );
      state.editorChapter = {
        ...state.editorChapter,
        expandedDeletedRowGroupIds,
        sourceWordCounts:
          payload?.sourceWordCounts && typeof payload.sourceWordCounts === "object"
            ? payload.sourceWordCounts
            : state.editorChapter.sourceWordCounts,
      };
      applyEditorSelectionsToProjectState(state.editorChapter);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showNoticeBadge(message || "The row could not be restored.", render);
  }
}

export async function confirmEditorRowPermanentDeletion(render) {
  const editorChapter = state.editorChapter;
  const modal = editorChapter?.rowPermanentDeletionModal;
  if (!editorChapter?.chapterId || !modal?.isOpen || !modal.rowId) {
    return;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
    return;
  }
  if (!canPermanentlyDeleteProjectFiles(team)) {
    state.editorChapter = {
      ...editorChapter,
      rowPermanentDeletionModal: {
        ...modal,
        error: "You do not have permission to permanently delete rows in this team.",
      },
    };
    render?.();
    return;
  }

  state.editorChapter = {
    ...editorChapter,
    rowPermanentDeletionModal: {
      ...modal,
      status: "loading",
      error: "",
    },
  };
  render?.();

  try {
    const payload = await invoke("permanently_delete_gtms_editor_row", {
      input: {
        installationId: team.installationId,
        projectId: context.project.id,
        repoName: context.project.name,
        chapterId: editorChapter.chapterId,
        rowId: modal.rowId,
      },
    });

    if (state.editorChapter?.chapterId !== editorChapter.chapterId) {
      return;
    }

    applyStructuralEditorChange(render, () => {
      const previousRows = state.editorChapter.rows;
      removeEditorChapterRow(modal.rowId);
      const expandedDeletedRowGroupIds = expandedDeletedRowGroupIdsAfterPermanentDelete(
        previousRows,
        modal.rowId,
        state.editorChapter.expandedDeletedRowGroupIds,
        state.editorChapter.rows,
      );
      state.editorChapter = {
        ...state.editorChapter,
        expandedDeletedRowGroupIds,
        sourceWordCounts:
          payload?.sourceWordCounts && typeof payload.sourceWordCounts === "object"
            ? payload.sourceWordCounts
            : state.editorChapter.sourceWordCounts,
        rowPermanentDeletionModal: createEditorRowPermanentDeletionModalState(),
      };
      applyEditorSelectionsToProjectState(state.editorChapter);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (state.editorChapter?.chapterId === editorChapter.chapterId) {
      state.editorChapter = {
        ...state.editorChapter,
        rowPermanentDeletionModal: {
          ...state.editorChapter.rowPermanentDeletionModal,
          status: "idle",
          error: message,
        },
      };
      render?.();
    }
    showNoticeBadge(message || "The row could not be permanently deleted.", render);
  }
}

export function updateEditorRowFieldValue(rowId, languageCode, nextValue) {
  updateEditorRowFieldValueFlow(rowId, languageCode, nextValue, {
    updateEditorChapterRow,
  });
}

function scrollTranslateMainToTop() {
  const container = document.querySelector(".translate-main-scroll");
  if (!(container instanceof HTMLElement)) {
    return;
  }

  container.scrollTop = 0;
}

export function updateEditorSearchFilterQuery(render, nextValue) {
  const previousSearchQuery = normalizeEditorChapterFilters(state.editorChapter?.filters).searchQuery;
  const nextSearchQuery = typeof nextValue === "string" ? nextValue : String(nextValue ?? "");
  const searchChanged = previousSearchQuery !== nextSearchQuery;
  const searchIsActive = nextSearchQuery.trim().length > 0;
  const currentReplaceState = normalizeEditorReplaceState(state.editorChapter?.replace);
  state.editorChapter = {
    ...state.editorChapter,
    filters: {
      ...normalizeEditorChapterFilters(state.editorChapter?.filters),
      searchQuery: nextSearchQuery,
    },
    replace: {
      ...currentReplaceState,
      enabled: searchIsActive ? currentReplaceState.enabled : false,
      selectedRowIds: searchChanged ? new Set() : cloneEditorReplaceSelectedRowIds(currentReplaceState.selectedRowIds),
      status: "idle",
      error: "",
    },
  };
  render?.();
  void waitForNextPaint().then(() => {
    scrollTranslateMainToTop();
  });
}

export function toggleEditorSearchFilterCaseSensitive(render, enabled) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  const nextCaseSensitive = enabled === true;
  const currentFilters = normalizeEditorChapterFilters(state.editorChapter?.filters);
  if (currentFilters.caseSensitive === nextCaseSensitive) {
    return;
  }

  const searchIsActive = currentFilters.searchQuery.trim().length > 0;
  const currentReplaceState = normalizeEditorReplaceState(state.editorChapter?.replace);
  state.editorChapter = {
    ...state.editorChapter,
    filters: {
      ...currentFilters,
      caseSensitive: nextCaseSensitive,
    },
    replace: {
      ...currentReplaceState,
      enabled: searchIsActive ? currentReplaceState.enabled : false,
      selectedRowIds: new Set(),
      status: "idle",
      error: "",
    },
  };
  render?.();
  void waitForNextPaint().then(() => {
    scrollTranslateMainToTop();
  });
}

export function toggleEditorReplaceEnabled(render, enabled, anchorTarget = null) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  const scrollAnchor = captureTranslateRowAnchor(anchorTarget);
  const searchIsActive = normalizeEditorChapterFilters(state.editorChapter?.filters).searchQuery.trim().length > 0;
  updateEditorReplaceState(state, (replaceState) => ({
    ...replaceState,
    enabled: searchIsActive && enabled === true,
    selectedRowIds: new Set(),
    status: "idle",
    error: "",
  }));
  render?.();
  if (scrollAnchor) {
    void waitForNextPaint().then(() => restoreTranslateRowAnchor(scrollAnchor));
  }
}

export function updateEditorReplaceQuery(render, nextValue) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  updateEditorReplaceState(state, (replaceState) => ({
    ...replaceState,
    replaceQuery: typeof nextValue === "string" ? nextValue : String(nextValue ?? ""),
    status: "idle",
    error: "",
  }));
  render?.();
}

export function toggleEditorReplaceRowSelected(render, rowId, selected, anchorTarget = null) {
  if (!rowId || !state.editorChapter?.chapterId) {
    return;
  }

  const scrollAnchor = captureTranslateRowAnchor(anchorTarget);

  const matchingRowIds = new Set(
    currentMatchingEditorReplaceRowIds(
      state.editorChapter,
      (row, chapterState) => buildEditorRowSearchHighlightMap(row, chapterState).size > 0,
    ),
  );
  if (!matchingRowIds.has(rowId)) {
    return;
  }

  updateEditorReplaceState(state, (replaceState) => {
    const selectedRowIds = cloneEditorReplaceSelectedRowIds(replaceState.selectedRowIds);
    if (selected) {
      selectedRowIds.add(rowId);
    } else {
      selectedRowIds.delete(rowId);
    }

    return {
      ...replaceState,
      selectedRowIds,
      status: "idle",
      error: "",
    };
  });
  render?.();
  if (scrollAnchor) {
    void waitForNextPaint().then(() => restoreTranslateRowAnchor(scrollAnchor));
  }
}

export function selectAllEditorReplaceRows(render) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  updateEditorReplaceState(state, (replaceState) => ({
    ...replaceState,
    selectedRowIds: new Set(
      currentMatchingEditorReplaceRowIds(
        state.editorChapter,
        (row, chapterState) => buildEditorRowSearchHighlightMap(row, chapterState).size > 0,
      ),
    ),
    status: "idle",
    error: "",
  }));
  render?.();
}

export async function replaceSelectedEditorRows(render) {
  const editorChapter = state.editorChapter;
  if (!editorChapter?.chapterId) {
    return;
  }

  const replaceState = normalizeEditorReplaceState(editorChapter.replace);
  if (!replaceState.enabled || replaceState.status === "saving") {
    return;
  }

  const searchQuery = normalizeEditorChapterFilters(editorChapter.filters).searchQuery.trim();
  const caseSensitive = normalizeEditorChapterFilters(editorChapter.filters).caseSensitive === true;
  if (!searchQuery) {
    return;
  }

  const selectedRowIds = selectedMatchingEditorReplaceRowIds(
    editorChapter,
    (row, chapterState) => buildEditorRowSearchHighlightMap(row, chapterState).size > 0,
  );
  if (selectedRowIds.length === 0) {
    showNoticeBadge("Select at least one matching row to replace.", render);
    return;
  }

  const selectedRows = selectedRowIds
    .map((rowId) => findEditorRowById(rowId, editorChapter))
    .filter(Boolean);
  if (selectedRows.some((row) => row.saveStatus === "saving" || row.markerSaveState?.status === "saving")) {
    showNoticeBadge("Wait for the selected rows to finish saving before replacing.", render);
    return;
  }

  const replacePlan = buildEditorBatchReplaceUpdates({
    rows: editorChapter.rows,
    selectedRowIds: new Set(selectedRowIds),
    visibleLanguageCodes: buildVisibleEditorLanguageCodeSet(editorChapter),
    searchQuery,
    replaceText: replaceState.replaceQuery,
    caseSensitive,
  });
  if (replacePlan.updatedRows.length === 0) {
    showNoticeBadge("Nothing to replace in the selected rows.", render);
    return;
  }

  const affectedRowIds = new Set(replacePlan.updatedRowIds);
  const resetRows = selectedRows
    .filter((row) => affectedRowIds.has(row.rowId))
    .filter((row) => !rowFieldsEqual(row.fields, row.persistedFields))
    .map((row) => ({
      rowId: row.rowId,
      fields: cloneRowFields(row.fields),
    }));

  const team = selectedProjectsTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
    return;
  }

  updateEditorReplaceState(state, (currentState) => ({
    ...currentState,
    status: "saving",
    error: "",
  }));
  render?.();

  try {
    if (resetRows.length > 0) {
      const resetPayload = await commitEditorRowFieldsBatch({
        installationId: team.installationId,
        projectId: context.project.id,
        repoName: context.project.name,
        chapterId: editorChapter.chapterId,
        rows: resetRows,
        commitMessage: buildEditorReplaceResetCommitMessage(resetRows.length),
        operation: "editor-replace-reset",
      });

      if (state.editorChapter?.chapterId === editorChapter.chapterId) {
        markEditorRowsPersisted(resetRows, resetPayload?.sourceWordCounts);
      }
    }

    const payload = await commitEditorRowFieldsBatch({
      installationId: team.installationId,
      projectId: context.project.id,
      repoName: context.project.name,
      chapterId: editorChapter.chapterId,
      rows: replacePlan.updatedRows,
      commitMessage: buildEditorReplaceCommitMessage(searchQuery, replacePlan.updatedRows.length),
      operation: "editor-replace",
    });

    if (state.editorChapter?.chapterId === editorChapter.chapterId) {
      markEditorRowsPersisted(replacePlan.updatedRows, payload?.sourceWordCounts);
      updateEditorReplaceState(state, (currentState) => ({
        ...currentState,
        status: "idle",
        error: "",
        selectedRowIds: new Set(),
      }));
      render?.();
      if (affectedRowIds.has(state.editorChapter.activeRowId)) {
        loadActiveEditorFieldHistory(render);
      }
      showNoticeBadge(`Replaced text in ${formatReplaceRowCount(replacePlan.updatedRows.length)}.`, render);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (state.editorChapter?.chapterId === editorChapter.chapterId) {
      updateEditorReplaceState(state, (currentState) => ({
        ...currentState,
        status: "idle",
        error: message,
      }));
      render?.();
    }
    showNoticeBadge(message || "The selected rows could not be replaced.", render);
  }
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
