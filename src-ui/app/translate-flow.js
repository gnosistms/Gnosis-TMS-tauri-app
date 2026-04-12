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
  cloneDirtyRowIds,
  reconcileDirtyRowIds,
  resolveDirtyTrackedEditorRowIds,
  rowFieldsEqual,
  rowHasFieldChanges,
  rowHasPersistedChanges,
  rowNeedsDirtyTracking,
} from "./editor-row-persistence-model.js";
import { normalizeEditorChapterFilterState } from "./editor-filters.js";
import { buildEditorBatchReplaceUpdates } from "./editor-replace.js";
import {
  ensureProjectNotTombstoned,
  findChapterContext,
  selectedProjectsTeam,
} from "./project-chapter-flow.js";
import { invoke, waitForNextPaint } from "./runtime.js";
import { saveStoredEditorFontSizePx } from "./editor-preferences.js";
import { historyEntryCanUndoReplace, reconcileExpandedEditorHistoryGroupKeys } from "./editor-history.js";
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
const pendingEditorRowPersistByRowId = new Map();
const pendingEditorDirtyRowScanFrameByRowId = new Map();

export function findChapterContextById(chapterId = state.selectedChapterId) {
  return chapterId ? findChapterContext(chapterId) : null;
}

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

function cloneRowFields(fields) {
  return Object.fromEntries(
    Object.entries(fields && typeof fields === "object" ? fields : {}).map(([code, value]) => [
      code,
      typeof value === "string" ? value : String(value ?? ""),
    ]),
  );
}

function normalizeFieldState(fieldState) {
  return {
    reviewed: fieldState?.reviewed === true,
    pleaseCheck: fieldState?.pleaseCheck === true,
  };
}

function cloneRowFieldStates(fieldStates) {
  return Object.fromEntries(
    Object.entries(fieldStates && typeof fieldStates === "object" ? fieldStates : {}).map(([code, value]) => [
      code,
      normalizeFieldState(value),
    ]),
  );
}

function buildEditorHistoryRequestKey(chapterId, rowId, languageCode) {
  if (!chapterId || !rowId || !languageCode) {
    return null;
  }

  return `${chapterId}:${rowId}:${languageCode}`;
}

function normalizeEditorHistoryState(history) {
  return {
    ...createEditorHistoryState(),
    ...(history && typeof history === "object" ? history : {}),
    rowId: typeof history?.rowId === "string" ? history.rowId : null,
    languageCode: typeof history?.languageCode === "string" ? history.languageCode : null,
    requestKey: typeof history?.requestKey === "string" ? history.requestKey : null,
    restoringCommitSha:
      typeof history?.restoringCommitSha === "string" ? history.restoringCommitSha : null,
    expandedGroupKeys: cloneExpandedHistoryGroupKeys(history?.expandedGroupKeys),
    entries: Array.isArray(history?.entries) ? history.entries : [],
  };
}

function normalizeEditorChapterFilters(filters) {
  return normalizeEditorChapterFilterState(filters);
}

function cloneEditorReplaceSelectedRowIds(selectedRowIds) {
  return selectedRowIds instanceof Set
    ? new Set([...selectedRowIds].filter(Boolean))
    : new Set();
}

function normalizeEditorReplaceState(replace) {
  return {
    ...createEditorReplaceState(),
    ...(replace && typeof replace === "object" ? replace : {}),
    enabled: replace?.enabled === true,
    replaceQuery: typeof replace?.replaceQuery === "string" ? replace.replaceQuery : "",
    selectedRowIds: cloneEditorReplaceSelectedRowIds(replace?.selectedRowIds),
    status: replace?.status === "saving" ? "saving" : "idle",
    error: typeof replace?.error === "string" ? replace.error : "",
  };
}

function normalizeEditorReplaceUndoModalState(modal) {
  return {
    ...createEditorReplaceUndoModalState(),
    ...(modal && typeof modal === "object" ? modal : {}),
    commitSha: typeof modal?.commitSha === "string" ? modal.commitSha : null,
  };
}

function cloneCollapsedLanguageCodes(collapsedLanguageCodes) {
  return collapsedLanguageCodes instanceof Set
    ? new Set(collapsedLanguageCodes)
    : new Set();
}

function cloneExpandedHistoryGroupKeys(expandedGroupKeys) {
  return expandedGroupKeys instanceof Set
    ? new Set(expandedGroupKeys)
    : new Set();
}

function cloneExpandedDeletedRowGroupIds(expandedDeletedRowGroupIds) {
  return expandedDeletedRowGroupIds instanceof Set
    ? new Set(expandedDeletedRowGroupIds)
    : new Set();
}

function compactDirtyRowIds(rows, dirtyRowIds) {
  const validRowIds = new Set(
    (Array.isArray(rows) ? rows : [])
      .map((row) => row?.rowId)
      .filter(Boolean),
  );

  return new Set(
    [...cloneDirtyRowIds(dirtyRowIds)].filter((rowId) => validRowIds.has(rowId)),
  );
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

function hasEditorRow(chapterState, rowId) {
  return Array.isArray(chapterState?.rows)
    && chapterState.rows.some((row) => row?.rowId === rowId);
}

function hasEditorLanguage(chapterState, languageCode) {
  return Array.isArray(chapterState?.languages)
    && chapterState.languages.some((language) => language?.code === languageCode);
}

function hasActiveEditorField(chapterState) {
  return hasEditorRow(chapterState, chapterState?.activeRowId)
    && hasEditorLanguage(chapterState, chapterState?.activeLanguageCode);
}

function currentEditorHistoryForSelection(chapterState, rowId, languageCode) {
  const history = normalizeEditorHistoryState(chapterState?.history);
  if (history.rowId === rowId && history.languageCode === languageCode) {
    return history;
  }

  return createEditorHistoryState();
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

function findEditorRowById(rowId, chapterState = state.editorChapter) {
  return chapterState?.rows?.find((row) => row?.rowId === rowId) ?? null;
}

function dirtyTrackedEditorRowIds(chapterState = state.editorChapter, rowIds = null) {
  return resolveDirtyTrackedEditorRowIds(chapterState?.dirtyRowIds, { rowIds });
}

function setEditorDirtyRowIds(dirtyRowIds) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    dirtyRowIds,
  };
}

function markEditorRowDirty(rowId) {
  if (!rowId || !state.editorChapter?.chapterId) {
    return;
  }

  const dirtyRowIds = cloneDirtyRowIds(state.editorChapter.dirtyRowIds);
  if (dirtyRowIds.has(rowId)) {
    return;
  }

  dirtyRowIds.add(rowId);
  setEditorDirtyRowIds(dirtyRowIds);
}

function reconcileDirtyTrackedEditorRows(rowIds = null) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  const currentDirtyRowIds = cloneDirtyRowIds(state.editorChapter.dirtyRowIds);
  const nextDirtyRowIds = reconcileDirtyRowIds(
    state.editorChapter.rows,
    currentDirtyRowIds,
    rowIds,
  );
  const dirtyRowIdsChanged =
    nextDirtyRowIds.size !== currentDirtyRowIds.size
    || [...nextDirtyRowIds].some((rowId) => !currentDirtyRowIds.has(rowId));
  if (dirtyRowIdsChanged) {
    setEditorDirtyRowIds(nextDirtyRowIds);
  }
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

function deletedRowGroupIdAfterSoftDelete(rows, rowId) {
  const items = Array.isArray(rows) ? rows : [];
  const rowIndex = items.findIndex((row) => row?.rowId === rowId);
  if (rowIndex < 0) {
    return null;
  }

  let startIndex = rowIndex;
  let endIndex = rowIndex;
  while (startIndex > 0 && items[startIndex - 1]?.lifecycleState === "deleted") {
    startIndex -= 1;
  }
  while (endIndex + 1 < items.length && items[endIndex + 1]?.lifecycleState === "deleted") {
    endIndex += 1;
  }

  const groupRowIds = items
    .slice(startIndex, endIndex + 1)
    .map((row) => row?.rowId)
    .filter(Boolean);
  if (!groupRowIds.includes(rowId)) {
    groupRowIds.splice(rowIndex - startIndex, 0, rowId);
  }
  return groupRowIds.length > 0 ? groupRowIds.join(":") : null;
}

function deletedRowGroupBoundsForRow(rows, rowId) {
  const items = Array.isArray(rows) ? rows : [];
  const rowIndex = items.findIndex((row) => row?.rowId === rowId);
  if (rowIndex < 0 || items[rowIndex]?.lifecycleState !== "deleted") {
    return null;
  }

  let startIndex = rowIndex;
  let endIndex = rowIndex;
  while (startIndex > 0 && items[startIndex - 1]?.lifecycleState === "deleted") {
    startIndex -= 1;
  }
  while (endIndex + 1 < items.length && items[endIndex + 1]?.lifecycleState === "deleted") {
    endIndex += 1;
  }

  return {
    rowIndex,
    startIndex,
    endIndex,
  };
}

function deletedRowGroupIdFromRange(rows, startIndex, endIndex) {
  if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex) || startIndex > endIndex) {
    return null;
  }

  const groupRowIds = (Array.isArray(rows) ? rows : [])
    .slice(startIndex, endIndex + 1)
    .map((row) => row?.rowId)
    .filter(Boolean);
  return groupRowIds.length > 0 ? groupRowIds.join(":") : null;
}

function existingDeletedRowGroupIds(rows) {
  const items = Array.isArray(rows) ? rows : [];
  const groupIds = new Set();
  let index = 0;
  while (index < items.length) {
    if (items[index]?.lifecycleState !== "deleted") {
      index += 1;
      continue;
    }

    const startIndex = index;
    while (index + 1 < items.length && items[index + 1]?.lifecycleState === "deleted") {
      index += 1;
    }
    const groupId = deletedRowGroupIdFromRange(items, startIndex, index);
    if (groupId) {
      groupIds.add(groupId);
    }
    index += 1;
  }

  return groupIds;
}

function compactExpandedDeletedRowGroupIds(rows, expandedDeletedRowGroupIds) {
  const validGroupIds = existingDeletedRowGroupIds(rows);
  return new Set(
    [...cloneExpandedDeletedRowGroupIds(expandedDeletedRowGroupIds)].filter((groupId) =>
      validGroupIds.has(groupId)
    ),
  );
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

function deletedRowGroupIdsAdjacentToSoftDelete(rows, rowId) {
  const items = Array.isArray(rows) ? rows : [];
  const rowIndex = items.findIndex((row) => row?.rowId === rowId);
  if (rowIndex < 0) {
    return [];
  }

  const groupIds = [];

  if (rowIndex > 0 && items[rowIndex - 1]?.lifecycleState === "deleted") {
    let startIndex = rowIndex - 1;
    while (startIndex > 0 && items[startIndex - 1]?.lifecycleState === "deleted") {
      startIndex -= 1;
    }
    const leftGroupId = items
      .slice(startIndex, rowIndex)
      .map((row) => row?.rowId)
      .filter(Boolean)
      .join(":");
    if (leftGroupId) {
      groupIds.push(leftGroupId);
    }
  }

  if (rowIndex + 1 < items.length && items[rowIndex + 1]?.lifecycleState === "deleted") {
    let endIndex = rowIndex + 1;
    while (endIndex + 1 < items.length && items[endIndex + 1]?.lifecycleState === "deleted") {
      endIndex += 1;
    }
    const rightGroupId = items
      .slice(rowIndex + 1, endIndex + 1)
      .map((row) => row?.rowId)
      .filter(Boolean)
      .join(":");
    if (rightGroupId) {
      groupIds.push(rightGroupId);
    }
  }

  return [...new Set(groupIds)];
}

function expandedDeletedRowGroupIdsAfterSoftDelete(
  previousRows,
  rowId,
  expandedDeletedRowGroupIds,
  nextRows,
) {
  const nextExpandedDeletedRowGroupIds = cloneExpandedDeletedRowGroupIds(expandedDeletedRowGroupIds);
  const adjacentGroupIds = deletedRowGroupIdsAdjacentToSoftDelete(previousRows, rowId);
  const nextGroupId = deletedRowGroupIdAfterSoftDelete(previousRows, rowId);
  const shouldStayOpen = adjacentGroupIds.some((groupId) => nextExpandedDeletedRowGroupIds.has(groupId));

  for (const groupId of adjacentGroupIds) {
    nextExpandedDeletedRowGroupIds.delete(groupId);
  }

  if (nextGroupId && shouldStayOpen) {
    nextExpandedDeletedRowGroupIds.add(nextGroupId);
  }

  return compactExpandedDeletedRowGroupIds(nextRows, nextExpandedDeletedRowGroupIds);
}

function expandedDeletedRowGroupIdsAfterRestore(
  previousRows,
  rowId,
  expandedDeletedRowGroupIds,
  nextRows,
) {
  const nextExpandedDeletedRowGroupIds = cloneExpandedDeletedRowGroupIds(expandedDeletedRowGroupIds);
  const bounds = deletedRowGroupBoundsForRow(previousRows, rowId);
  if (!bounds) {
    return compactExpandedDeletedRowGroupIds(nextRows, nextExpandedDeletedRowGroupIds);
  }

  const previousGroupId = deletedRowGroupIdFromRange(previousRows, bounds.startIndex, bounds.endIndex);
  const shouldStayOpen = previousGroupId ? nextExpandedDeletedRowGroupIds.has(previousGroupId) : false;

  if (previousGroupId) {
    nextExpandedDeletedRowGroupIds.delete(previousGroupId);
  }

  const leftGroupId =
    bounds.startIndex <= bounds.rowIndex - 1
      ? deletedRowGroupIdFromRange(nextRows, bounds.startIndex, bounds.rowIndex - 1)
      : null;
  const rightGroupId =
    bounds.rowIndex + 1 <= bounds.endIndex
      ? deletedRowGroupIdFromRange(nextRows, bounds.rowIndex + 1, bounds.endIndex)
      : null;

  if (shouldStayOpen && leftGroupId) {
    nextExpandedDeletedRowGroupIds.add(leftGroupId);
  }
  if (shouldStayOpen && rightGroupId) {
    nextExpandedDeletedRowGroupIds.add(rightGroupId);
  }

  return compactExpandedDeletedRowGroupIds(nextRows, nextExpandedDeletedRowGroupIds);
}

function expandedDeletedRowGroupIdsAfterPermanentDelete(
  previousRows,
  rowId,
  expandedDeletedRowGroupIds,
  nextRows,
) {
  const nextExpandedDeletedRowGroupIds = cloneExpandedDeletedRowGroupIds(expandedDeletedRowGroupIds);
  const bounds = deletedRowGroupBoundsForRow(previousRows, rowId);
  if (!bounds) {
    return compactExpandedDeletedRowGroupIds(nextRows, nextExpandedDeletedRowGroupIds);
  }

  const previousGroupId = deletedRowGroupIdFromRange(previousRows, bounds.startIndex, bounds.endIndex);
  const shouldStayOpen = previousGroupId ? nextExpandedDeletedRowGroupIds.has(previousGroupId) : false;

  if (previousGroupId) {
    nextExpandedDeletedRowGroupIds.delete(previousGroupId);
  }

  const nextGroupId =
    bounds.startIndex <= bounds.endIndex - 1
      ? deletedRowGroupIdFromRange(nextRows, bounds.startIndex, bounds.endIndex - 1)
      : null;

  if (shouldStayOpen && nextGroupId) {
    nextExpandedDeletedRowGroupIds.add(nextGroupId);
  }

  return compactExpandedDeletedRowGroupIds(nextRows, nextExpandedDeletedRowGroupIds);
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

function buildVisibleEditorLanguageCodeSet(chapterState = state.editorChapter) {
  const collapsedLanguageCodes =
    chapterState?.collapsedLanguageCodes instanceof Set
      ? chapterState.collapsedLanguageCodes
      : new Set();

  return new Set(
    (Array.isArray(chapterState?.languages) ? chapterState.languages : [])
      .map((language) => (typeof language?.code === "string" ? language.code.trim() : ""))
      .filter((code) => code && !collapsedLanguageCodes.has(code)),
  );
}

function currentMatchingEditorReplaceRowIds(chapterState = state.editorChapter) {
  return (Array.isArray(chapterState?.rows) ? chapterState.rows : [])
    .filter((row) => row?.lifecycleState !== "deleted")
    .filter((row) => buildEditorRowSearchHighlightMap(row, chapterState).size > 0)
    .map((row) => row.rowId)
    .filter(Boolean);
}

function selectedMatchingEditorReplaceRowIds(chapterState = state.editorChapter) {
  const replaceState = normalizeEditorReplaceState(chapterState?.replace);
  if (!replaceState.enabled) {
    return [];
  }

  const matchingRowIds = new Set(currentMatchingEditorReplaceRowIds(chapterState));
  return [...replaceState.selectedRowIds].filter((rowId) => matchingRowIds.has(rowId));
}

function updateEditorReplaceState(nextValue) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  const currentReplaceState = normalizeEditorReplaceState(state.editorChapter?.replace);
  state.editorChapter = {
    ...state.editorChapter,
    replace:
      typeof nextValue === "function"
        ? normalizeEditorReplaceState(nextValue(currentReplaceState))
        : normalizeEditorReplaceState(nextValue),
  };
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

function formatReplaceRowCount(rowCount) {
  return rowCount === 1 ? "1 row" : `${rowCount} rows`;
}

function summarizeReplaceSearchQuery(searchQuery, maxLength = 36) {
  const text = String(searchQuery ?? "").trim();
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}...`;
}

function buildEditorReplaceResetCommitMessage(rowCount) {
  return `Create reset point before replace in ${formatReplaceRowCount(rowCount)}`;
}

function buildEditorReplaceCommitMessage(searchQuery, rowCount) {
  const queryLabel = summarizeReplaceSearchQuery(searchQuery);
  return `Replace "${queryLabel}" in ${formatReplaceRowCount(rowCount)}`;
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

function hasPendingEditorRowWrites(chapterState = state.editorChapter) {
  return (Array.isArray(chapterState?.rows) ? chapterState.rows : []).some((row) =>
    row?.saveStatus !== "idle" || row?.markerSaveState?.status === "saving"
  );
}

function currentActiveHistoryEntryByCommitSha(commitSha, chapterState = state.editorChapter) {
  if (!commitSha || !hasActiveEditorField(chapterState)) {
    return null;
  }

  const history = currentEditorHistoryForSelection(
    chapterState,
    chapterState.activeRowId,
    chapterState.activeLanguageCode,
  );
  return history.entries.find((entry) => entry?.commitSha === commitSha) ?? null;
}

export function openEditorReplaceUndoModal(commitSha) {
  const entry = currentActiveHistoryEntryByCommitSha(commitSha);
  if (!state.editorChapter?.chapterId || !historyEntryCanUndoReplace(entry)) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    replaceUndoModal: {
      ...createEditorReplaceUndoModalState(),
      isOpen: true,
      status: "idle",
      error: "",
      commitSha,
    },
  };
}

export function cancelEditorReplaceUndoModal() {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    replaceUndoModal: createEditorReplaceUndoModalState(),
  };
}

function buildEditorReplaceUndoNotice(updatedCount, skippedCount) {
  const updatedLabel = formatReplaceRowCount(updatedCount);
  const skippedLabel = formatReplaceRowCount(skippedCount);
  if (updatedCount > 0 && skippedCount > 0) {
    return `Undid replace in ${updatedLabel}. ${skippedLabel} ${skippedCount === 1 ? "was" : "were"} left unchanged because ${skippedCount === 1 ? "it was" : "they were"} edited later.`;
  }
  if (updatedCount > 0) {
    return `Undid replace in ${updatedLabel}.`;
  }
  if (skippedCount === 0) {
    return "No rows needed to be undone.";
  }
  return `No rows were undone. ${skippedLabel} ${skippedCount === 1 ? "was" : "were"} edited later and left unchanged.`;
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

async function fetchEditorFieldHistory(render, requestKey) {
  const editorChapter = state.editorChapter;
  if (!editorChapter?.chapterId || !editorChapter.activeRowId || !editorChapter.activeLanguageCode) {
    return;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
    return;
  }

  const rowId = editorChapter.activeRowId;
  const languageCode = editorChapter.activeLanguageCode;

  try {
    const payload = await invoke("load_gtms_editor_field_history", {
      input: {
        installationId: team.installationId,
        projectId: context.project.id,
        repoName: context.project.name,
        chapterId: editorChapter.chapterId,
        rowId,
        languageCode,
      },
    });

    if (
      state.editorChapter?.chapterId !== editorChapter.chapterId
      || state.editorChapter.activeRowId !== rowId
      || state.editorChapter.activeLanguageCode !== languageCode
      || state.editorChapter.history?.requestKey !== requestKey
    ) {
      return;
    }

    const previousHistory = normalizeEditorHistoryState(state.editorChapter.history);
    state.editorChapter = {
      ...state.editorChapter,
      history: {
        status: "ready",
        error: "",
        rowId,
        languageCode,
        requestKey,
        restoringCommitSha: null,
        expandedGroupKeys: reconcileExpandedEditorHistoryGroupKeys(
          previousHistory.entries,
          Array.isArray(payload?.entries) ? payload.entries : [],
          previousHistory.expandedGroupKeys,
        ),
        entries: Array.isArray(payload?.entries) ? payload.entries : [],
      },
    };
    render?.();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      state.editorChapter?.chapterId !== editorChapter.chapterId
      || state.editorChapter.activeRowId !== rowId
      || state.editorChapter.activeLanguageCode !== languageCode
      || state.editorChapter.history?.requestKey !== requestKey
    ) {
      return;
    }

    state.editorChapter = {
      ...state.editorChapter,
      history: {
        ...normalizeEditorHistoryState(state.editorChapter.history),
        status: "error",
        error: message,
        rowId,
        languageCode,
        requestKey,
        restoringCommitSha: null,
        expandedGroupKeys: cloneExpandedHistoryGroupKeys(state.editorChapter.history?.expandedGroupKeys),
      },
    };
    render?.();
  }
}

export function loadActiveEditorFieldHistory(render) {
  const editorChapter = state.editorChapter;
  if (!editorChapter?.chapterId || !hasActiveEditorField(editorChapter)) {
    return;
  }

  const currentHistory = currentEditorHistoryForSelection(
    editorChapter,
    editorChapter.activeRowId,
    editorChapter.activeLanguageCode,
  );
  const requestKey = buildEditorHistoryRequestKey(
    editorChapter.chapterId,
    editorChapter.activeRowId,
    editorChapter.activeLanguageCode,
  );
  state.editorChapter = {
    ...editorChapter,
    history: {
      ...normalizeEditorHistoryState(editorChapter.history),
      status: "loading",
      error: "",
      rowId: editorChapter.activeRowId,
      languageCode: editorChapter.activeLanguageCode,
      requestKey,
      restoringCommitSha: null,
      expandedGroupKeys: cloneExpandedHistoryGroupKeys(currentHistory.expandedGroupKeys),
    },
  };
  void fetchEditorFieldHistory(render, requestKey);
}

export function setActiveEditorField(render, rowId, languageCode) {
  if (!rowId || !languageCode || !hasEditorRow(state.editorChapter, rowId) || !hasEditorLanguage(state.editorChapter, languageCode)) {
    return;
  }

  const editorChapter = state.editorChapter;
  if (
    editorChapter.activeRowId === rowId
    && editorChapter.activeLanguageCode === languageCode
    && (editorChapter.history?.status === "loading" || editorChapter.history?.status === "ready")
  ) {
    return;
  }

  state.editorChapter = {
    ...editorChapter,
    activeRowId: rowId,
    activeLanguageCode: languageCode,
  };
  loadActiveEditorFieldHistory(render);
}

export function scheduleDirtyEditorRowScan(render, rowId) {
  if (!rowId || typeof window === "undefined") {
    return;
  }

  const previousFrameId = pendingEditorDirtyRowScanFrameByRowId.get(rowId);
  if (previousFrameId) {
    window.cancelAnimationFrame(previousFrameId);
  }

  const frameId = window.requestAnimationFrame(() => {
    pendingEditorDirtyRowScanFrameByRowId.delete(rowId);
    const activeElement = document.activeElement;
    const focusedRowId =
      activeElement instanceof HTMLTextAreaElement && activeElement.matches("[data-editor-row-field]")
        ? activeElement.dataset.rowId ?? ""
        : "";
    if (focusedRowId === rowId) {
      return;
    }

    void flushDirtyEditorRows(render, { rowIds: [rowId] });
  });

  pendingEditorDirtyRowScanFrameByRowId.set(rowId, frameId);
}

export async function flushDirtyEditorRows(render, options = {}) {
  if (!state.editorChapter?.chapterId) {
    return true;
  }

  const candidateRowIds = resolveDirtyTrackedEditorRowIds(state.editorChapter?.dirtyRowIds, {
    rowIds: Array.isArray(options?.rowIds) ? options.rowIds : null,
    excludeRowId: typeof options?.excludeRowId === "string" ? options.excludeRowId : "",
  });
  if (candidateRowIds.length === 0) {
    return true;
  }

  for (const rowId of candidateRowIds) {
    const row = findEditorRowById(rowId, state.editorChapter);
    if (!row) {
      reconcileDirtyTrackedEditorRows([rowId]);
      continue;
    }

    if (!rowHasPersistedChanges(row)) {
      reconcileDirtyTrackedEditorRows([rowId]);
      continue;
    }

    if (!rowHasFieldChanges(row)) {
      continue;
    }

    await persistEditorRowOnBlur(render, rowId);
  }

  reconcileDirtyTrackedEditorRows(candidateRowIds);
  return dirtyTrackedEditorRowIds(state.editorChapter, candidateRowIds).every((rowId) => {
    const row = findEditorRowById(rowId, state.editorChapter);
    return !row || !rowHasPersistedChanges(row);
  });
}

export function toggleEditorHistoryGroupExpanded(groupKey) {
  if (!groupKey || !state.editorChapter?.chapterId) {
    return;
  }

  const history = normalizeEditorHistoryState(state.editorChapter.history);
  const expandedGroupKeys = cloneExpandedHistoryGroupKeys(history.expandedGroupKeys);
  if (expandedGroupKeys.has(groupKey)) {
    expandedGroupKeys.delete(groupKey);
  } else {
    expandedGroupKeys.add(groupKey);
  }

  state.editorChapter = {
    ...state.editorChapter,
    history: {
      ...history,
      expandedGroupKeys,
    },
  };
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
  const editorChapter = state.editorChapter;
  if (!commitSha || !editorChapter?.chapterId || !hasActiveEditorField(editorChapter)) {
    return;
  }

  const row = findEditorRowById(editorChapter.activeRowId, editorChapter);
  if (!row || row.saveStatus !== "idle" || row.markerSaveState?.status === "saving") {
    showNoticeBadge("Save the current row before restoring history.", render);
    return;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
    return;
  }

  state.editorChapter = {
    ...editorChapter,
    history: {
      ...currentEditorHistoryForSelection(
        editorChapter,
        editorChapter.activeRowId,
        editorChapter.activeLanguageCode,
      ),
      status: "restoring",
      error: "",
      rowId: editorChapter.activeRowId,
      languageCode: editorChapter.activeLanguageCode,
      requestKey: buildEditorHistoryRequestKey(
        editorChapter.chapterId,
        editorChapter.activeRowId,
        editorChapter.activeLanguageCode,
      ),
      restoringCommitSha: commitSha,
    },
  };
  render?.();

  try {
    const payload = await invoke("restore_gtms_editor_field_from_history", {
      input: {
        installationId: team.installationId,
        projectId: context.project.id,
        repoName: context.project.name,
        chapterId: editorChapter.chapterId,
        rowId: editorChapter.activeRowId,
        languageCode: editorChapter.activeLanguageCode,
        commitSha,
      },
    });

    if (
      state.editorChapter?.chapterId === editorChapter.chapterId
      && state.editorChapter.activeRowId === editorChapter.activeRowId
      && state.editorChapter.activeLanguageCode === editorChapter.activeLanguageCode
    ) {
      updateEditorChapterRow(editorChapter.activeRowId, (currentRow) => ({
        ...currentRow,
        fields: {
          ...cloneRowFields(currentRow.fields),
          [editorChapter.activeLanguageCode]: payload?.plainText ?? "",
        },
        fieldStates: {
          ...cloneRowFieldStates(currentRow.fieldStates),
          [editorChapter.activeLanguageCode]: normalizeFieldState({
            reviewed: payload?.reviewed,
            pleaseCheck: payload?.pleaseCheck,
          }),
        },
        persistedFields: {
          ...cloneRowFields(currentRow.persistedFields),
          [editorChapter.activeLanguageCode]: payload?.plainText ?? "",
        },
        persistedFieldStates: {
          ...cloneRowFieldStates(currentRow.persistedFieldStates),
          [editorChapter.activeLanguageCode]: normalizeFieldState({
            reviewed: payload?.reviewed,
            pleaseCheck: payload?.pleaseCheck,
          }),
        },
        saveStatus: "idle",
        saveError: "",
      }));

      state.editorChapter = {
        ...state.editorChapter,
        sourceWordCounts:
          payload?.sourceWordCounts && typeof payload.sourceWordCounts === "object"
            ? payload.sourceWordCounts
            : state.editorChapter.sourceWordCounts,
        history: {
          ...normalizeEditorHistoryState(state.editorChapter.history),
          status: "idle",
          error: "",
          restoringCommitSha: null,
        },
      };
      reconcileDirtyTrackedEditorRows([editorChapter.activeRowId]);
      applyEditorSelectionsToProjectState(state.editorChapter);
      render?.();
      loadActiveEditorFieldHistory(render);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      state.editorChapter?.chapterId === editorChapter.chapterId
      && state.editorChapter.activeRowId === editorChapter.activeRowId
      && state.editorChapter.activeLanguageCode === editorChapter.activeLanguageCode
    ) {
      state.editorChapter = {
        ...state.editorChapter,
        history: {
          ...normalizeEditorHistoryState(state.editorChapter.history),
          status: "ready",
          error: "",
          restoringCommitSha: null,
        },
      };
      render?.();
    }
    showNoticeBadge(message || "The selected history entry could not be restored.", render);
  }
}

export async function confirmEditorReplaceUndo(render) {
  const editorChapter = state.editorChapter;
  const modal = normalizeEditorReplaceUndoModalState(editorChapter?.replaceUndoModal);
  if (!editorChapter?.chapterId || !modal.isOpen || !modal.commitSha || modal.status === "loading") {
    return;
  }

  if (!historyEntryCanUndoReplace(currentActiveHistoryEntryByCommitSha(modal.commitSha, editorChapter))) {
    state.editorChapter = {
      ...editorChapter,
      replaceUndoModal: {
        ...modal,
        status: "idle",
        error: "The selected batch replace history entry is no longer available.",
      },
    };
    render?.();
    return;
  }

  if (hasPendingEditorRowWrites(editorChapter)) {
    state.editorChapter = {
      ...editorChapter,
      replaceUndoModal: {
        ...modal,
        status: "idle",
        error: "Save or resolve current row edits before undoing a batch replace.",
      },
    };
    render?.();
    return;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
    return;
  }

  state.editorChapter = {
    ...editorChapter,
    replaceUndoModal: {
      ...modal,
      status: "loading",
      error: "",
    },
  };
  render?.();

  try {
    const payload = await invoke("reverse_gtms_editor_batch_replace_commit", {
      input: {
        installationId: team.installationId,
        projectId: context.project.id,
        repoName: context.project.name,
        chapterId: editorChapter.chapterId,
        commitSha: modal.commitSha,
      },
    });

    if (state.editorChapter?.chapterId === editorChapter.chapterId) {
      const updatedRows = Array.isArray(payload?.updatedRows) ? payload.updatedRows : [];
      const skippedRowCount = Array.isArray(payload?.skippedRowIds) ? payload.skippedRowIds.length : 0;
      if (updatedRows.length > 0) {
        markEditorRowsPersisted(updatedRows, payload?.sourceWordCounts);
      }
      state.editorChapter = {
        ...state.editorChapter,
        replaceUndoModal: createEditorReplaceUndoModalState(),
      };
      render?.();
      if (updatedRows.some((row) => row?.rowId === state.editorChapter.activeRowId)) {
        loadActiveEditorFieldHistory(render);
      }
      showNoticeBadge(buildEditorReplaceUndoNotice(updatedRows.length, skippedRowCount), render);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (state.editorChapter?.chapterId === editorChapter.chapterId) {
      state.editorChapter = {
        ...state.editorChapter,
        replaceUndoModal: {
          ...normalizeEditorReplaceUndoModalState(state.editorChapter.replaceUndoModal),
          status: "idle",
          error: message,
        },
      };
      render?.();
    }
  }
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
  if (!rowId || !languageCode) {
    return;
  }

  updateEditorChapterRow(rowId, (row) => {
    const fields = {
      ...cloneRowFields(row.fields),
      [languageCode]: nextValue,
    };
    const nextSaveStatus =
      row.saveStatus === "saving"
        ? "dirty"
        : rowFieldsEqual(fields, row.persistedFields)
          ? "idle"
          : "dirty";

    return {
      ...row,
      fields,
      saveStatus: nextSaveStatus,
      saveError: "",
    };
  });
  markEditorRowDirty(rowId);
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

export function toggleEditorReplaceEnabled(render, enabled) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  const searchIsActive = normalizeEditorChapterFilters(state.editorChapter?.filters).searchQuery.trim().length > 0;
  updateEditorReplaceState((replaceState) => ({
    ...replaceState,
    enabled: searchIsActive && enabled === true,
    selectedRowIds: new Set(),
    status: "idle",
    error: "",
  }));
  render?.();
}

export function updateEditorReplaceQuery(render, nextValue) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  updateEditorReplaceState((replaceState) => ({
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

  const matchingRowIds = new Set(currentMatchingEditorReplaceRowIds(state.editorChapter));
  if (!matchingRowIds.has(rowId)) {
    return;
  }

  updateEditorReplaceState((replaceState) => {
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

  updateEditorReplaceState((replaceState) => ({
    ...replaceState,
    selectedRowIds: new Set(currentMatchingEditorReplaceRowIds(state.editorChapter)),
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

  const selectedRowIds = selectedMatchingEditorReplaceRowIds(editorChapter);
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

  updateEditorReplaceState((currentState) => ({
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
      updateEditorReplaceState((currentState) => ({
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
      updateEditorReplaceState((currentState) => ({
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
  if (!rowId || !languageCode || (kind !== "reviewed" && kind !== "please-check")) {
    return;
  }

  const editorChapter = state.editorChapter;
  if (!editorChapter?.chapterId) {
    return;
  }

  const row = findEditorRowById(rowId, editorChapter);
  if (!row) {
    return;
  }

  if (row.saveStatus !== "idle") {
    showNoticeBadge("Save the row text before updating review markers.", render);
    return;
  }

  if (row.markerSaveState?.status === "saving") {
    return;
  }

  const currentFieldState = normalizeFieldState(row.fieldStates?.[languageCode]);
  const nextEnabled = kind === "reviewed"
    ? !currentFieldState.reviewed
    : !currentFieldState.pleaseCheck;
  const nextFieldState = {
    ...currentFieldState,
    ...(kind === "reviewed"
      ? { reviewed: nextEnabled }
      : { pleaseCheck: nextEnabled }),
  };

  const team = selectedProjectsTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
    return;
  }

  const previousFieldState = currentFieldState;
  markEditorRowDirty(rowId);
  updateEditorChapterRow(rowId, (currentRow) => ({
    ...currentRow,
    fieldStates: {
      ...cloneRowFieldStates(currentRow.fieldStates),
      [languageCode]: nextFieldState,
    },
    markerSaveState: {
      status: "saving",
      languageCode,
      kind,
      error: "",
    },
  }));
  render?.();

  try {
    const payload = await invoke("update_gtms_editor_row_field_flag", {
      input: {
        installationId: team.installationId,
        projectId: context.project.id,
        repoName: context.project.name,
        chapterId: editorChapter.chapterId,
        rowId,
        languageCode,
        flag: kind,
        enabled: nextEnabled,
      },
    });

    if (state.editorChapter?.chapterId === editorChapter.chapterId) {
      updateEditorChapterRow(rowId, (currentRow) => ({
        ...currentRow,
        fieldStates: {
          ...cloneRowFieldStates(currentRow.fieldStates),
          [languageCode]: normalizeFieldState({
            reviewed: payload?.reviewed,
            pleaseCheck: payload?.pleaseCheck,
          }),
        },
        persistedFieldStates: {
          ...cloneRowFieldStates(currentRow.persistedFieldStates),
          [languageCode]: normalizeFieldState({
            reviewed: payload?.reviewed,
            pleaseCheck: payload?.pleaseCheck,
          }),
        },
        markerSaveState: {
          status: "idle",
          languageCode: null,
          kind: null,
          error: "",
        },
      }));
      reconcileDirtyTrackedEditorRows([rowId]);
      render?.();

      if (state.editorChapter.activeRowId === rowId && state.editorChapter.activeLanguageCode === languageCode) {
        loadActiveEditorFieldHistory(render);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (state.editorChapter?.chapterId === editorChapter.chapterId) {
      updateEditorChapterRow(rowId, (currentRow) => ({
        ...currentRow,
        fieldStates: {
          ...cloneRowFieldStates(currentRow.fieldStates),
          [languageCode]: previousFieldState,
        },
        markerSaveState: {
          status: "idle",
          languageCode: null,
          kind: null,
          error: message,
        },
      }));
      reconcileDirtyTrackedEditorRows([rowId]);
      render?.();
    }
    showNoticeBadge(message || "The review marker could not be saved.", render);
  }
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
  if (!rowId || !state.editorChapter?.chapterId) {
    return;
  }

  const existingPersist = pendingEditorRowPersistByRowId.get(rowId);
  if (existingPersist) {
    const row = findEditorRowById(rowId, state.editorChapter);
    if (row?.saveStatus === "saving") {
      updateEditorChapterRow(rowId, (currentRow) => ({
        ...currentRow,
        saveStatus: "dirty",
      }));
    }
    await existingPersist;
    return;
  }

  const persistPromise = (async () => {
    while (state.editorChapter?.chapterId) {
      const editorChapter = state.editorChapter;
      const row = findEditorRowById(rowId, editorChapter);
      if (!row) {
        reconcileDirtyTrackedEditorRows([rowId]);
        return;
      }

      if (!rowHasFieldChanges(row)) {
        if (row.saveStatus !== "idle" || row.saveError) {
          updateEditorChapterRow(rowId, (currentRow) => ({
            ...currentRow,
            saveStatus: "idle",
            saveError: "",
          }));
          render?.();
        }
        reconcileDirtyTrackedEditorRows([rowId]);
        return;
      }

      const team = selectedProjectsTeam();
      const context = findChapterContextById(editorChapter.chapterId);
      if (!Number.isFinite(team?.installationId) || !context?.project?.name) {
        return;
      }

      const fieldsToPersist = cloneRowFields(row.fields);
      updateEditorChapterRow(rowId, (currentRow) => ({
        ...currentRow,
        saveStatus: "saving",
        saveError: "",
      }));
      render?.();

      try {
        const payload = await invoke("update_gtms_editor_row_fields", {
          input: {
            installationId: team.installationId,
            projectId: context.project.id,
            repoName: context.project.name,
            chapterId: editorChapter.chapterId,
            rowId,
            fields: fieldsToPersist,
          },
        });

        if (state.editorChapter?.chapterId !== editorChapter.chapterId) {
          return;
        }

        const updatedRow = updateEditorChapterRow(rowId, (currentRow) => {
          const rowChangedDuringSave = !rowFieldsEqual(currentRow.fields, fieldsToPersist);
          return {
            ...currentRow,
            persistedFields: cloneRowFields(fieldsToPersist),
            saveStatus: rowChangedDuringSave ? "dirty" : "idle",
            saveError: "",
          };
        });

        state.editorChapter = {
          ...state.editorChapter,
          sourceWordCounts:
            payload?.sourceWordCounts && typeof payload.sourceWordCounts === "object"
              ? payload.sourceWordCounts
              : state.editorChapter.sourceWordCounts,
        };
        reconcileDirtyTrackedEditorRows([rowId]);
        applyEditorSelectionsToProjectState(state.editorChapter);
        render?.();
        if (state.editorChapter.activeRowId === rowId) {
          loadActiveEditorFieldHistory(render);
        }

        if (updatedRow?.saveStatus !== "dirty") {
          return;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (state.editorChapter?.chapterId === editorChapter.chapterId) {
          updateEditorChapterRow(rowId, (currentRow) => ({
            ...currentRow,
            saveStatus: "error",
            saveError: message,
          }));
          reconcileDirtyTrackedEditorRows([rowId]);
          render?.();
        }
        showNoticeBadge(message || "The row could not be saved.", render);
        return;
      }
    }
  })();

  pendingEditorRowPersistByRowId.set(rowId, persistPromise);
  try {
    await persistPromise;
  } finally {
    pendingEditorRowPersistByRowId.delete(rowId);
  }
}
