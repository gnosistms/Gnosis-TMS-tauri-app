import { saveStoredProjectsForTeam } from "./project-cache.js";
import { pruneEditorCommentSeenRevisionsForRows } from "./editor-comments-state.js";
import { currentEditorHistoryForSelection } from "./editor-history-state.js";
import { compactDirtyRowIds, reconcileDirtyTrackedEditorRows } from "./editor-dirty-row-state.js";
import { normalizeEditorChapterFilterState } from "./editor-filters.js";
import { normalizeEditorReplaceState } from "./editor-replace.js";
import {
  cloneRowFields,
  cloneRowFieldStates,
  hasEditorLanguage,
  hasEditorRow,
} from "./editor-utils.js";
import { selectedProjectsTeam } from "./project-context.js";
import {
  coerceEditorFontSizePx,
  createEditorChapterFilterState,
  createEditorChapterGlossaryState,
  createEditorCommentsState,
  createEditorConflictResolutionModalState,
  createEditorReplaceUndoModalState,
  createEditorReplaceState,
  createEditorHistoryState,
  createEditorInsertRowModalState,
  createEditorRowPermanentDeletionModalState,
  state,
} from "./state.js";

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

export function applyEditorUiState(nextEditorChapter, previousEditorChapter = state.editorChapter) {
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
  const sidebarTab =
    typeof previousEditorChapter?.sidebarTab === "string"
      ? previousEditorChapter.sidebarTab
      : "history";

  return pruneEditorCommentSeenRevisionsForRows({
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
    conflictResolutionModal:
      isSameChapter
        && previousEditorChapter?.conflictResolutionModal?.isOpen === true
        && hasEditorRow(nextEditorChapter, previousEditorChapter.conflictResolutionModal.rowId)
        && hasEditorLanguage(nextEditorChapter, previousEditorChapter.conflictResolutionModal.languageCode)
        ? {
          ...createEditorConflictResolutionModalState(),
          ...previousEditorChapter.conflictResolutionModal,
        }
        : createEditorConflictResolutionModalState(),
    activeRowId:
      hasEditorRow(nextEditorChapter, activeRowId) && hasEditorLanguage(nextEditorChapter, activeLanguageCode)
        ? activeRowId
        : null,
    activeLanguageCode:
      hasEditorRow(nextEditorChapter, activeRowId) && hasEditorLanguage(nextEditorChapter, activeLanguageCode)
        ? activeLanguageCode
        : null,
    sidebarTab: sidebarTab === "comments" || sidebarTab === "duplicates" ? sidebarTab : "history",
    commentSeenRevisions:
      isSameChapter && previousEditorChapter?.commentSeenRevisions && typeof previousEditorChapter.commentSeenRevisions === "object"
        ? previousEditorChapter.commentSeenRevisions
        : {},
    chapterBaseCommitSha:
      typeof nextEditorChapter?.chapterBaseCommitSha === "string" && nextEditorChapter.chapterBaseCommitSha.trim()
        ? nextEditorChapter.chapterBaseCommitSha
        : null,
    deferredStructuralChanges: nextEditorChapter?.deferredStructuralChanges === true,
    backgroundSyncStatus:
      typeof nextEditorChapter?.backgroundSyncStatus === "string"
        ? nextEditorChapter.backgroundSyncStatus
        : "idle",
    backgroundSyncError:
      typeof nextEditorChapter?.backgroundSyncError === "string"
        ? nextEditorChapter.backgroundSyncError
        : "",
    comments:
      isSameChapter && hasEditorRow(nextEditorChapter, activeRowId)
        ? {
          ...createEditorCommentsState(),
          ...(previousEditorChapter?.comments && typeof previousEditorChapter.comments === "object"
            ? previousEditorChapter.comments
            : {}),
          rowId:
            previousEditorChapter?.comments?.rowId && hasEditorRow(nextEditorChapter, previousEditorChapter.comments.rowId)
              ? previousEditorChapter.comments.rowId
              : null,
          requestKey:
            previousEditorChapter?.comments?.rowId && hasEditorRow(nextEditorChapter, previousEditorChapter.comments.rowId)
              ? previousEditorChapter.comments.requestKey ?? null
              : null,
        }
        : createEditorCommentsState(),
    history:
      hasEditorRow(nextEditorChapter, activeRowId) && hasEditorLanguage(nextEditorChapter, activeLanguageCode)
        ? history
        : createEditorHistoryState(),
  });
}

export function normalizeEditorRow(row) {
  const fields = cloneRowFields(row?.fields);
  const fieldStates = cloneRowFieldStates(row?.fieldStates);
  return {
    ...row,
    lifecycleState: row?.lifecycleState === "deleted" ? "deleted" : "active",
    orderKey: typeof row?.orderKey === "string" ? row.orderKey : "",
    revisionToken:
      typeof row?.revisionToken === "string" && row.revisionToken.trim()
        ? row.revisionToken
        : "",
    commentCount: Number.isInteger(row?.commentCount) && row.commentCount >= 0 ? row.commentCount : 0,
    commentsRevision:
      Number.isInteger(row?.commentsRevision) && row.commentsRevision >= 0 ? row.commentsRevision : 0,
    fields,
    baseFields: cloneRowFields(fields),
    persistedFields: cloneRowFields(fields),
    fieldStates,
    persistedFieldStates: cloneRowFieldStates(fieldStates),
    freshness: "fresh",
    remotelyDeleted: false,
    conflictState: null,
    saveStatus: "idle",
    saveError: "",
    markerSaveState: {
      status: "idle",
      languageCode: null,
      kind: null,
      error: "",
    },
  };
}

export function normalizeEditorRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => normalizeEditorRow(row));
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

export function applyChapterMetadataToState(chapterId, updates) {
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

export function applyEditorSelectionsToProjectState(chapterState = state.editorChapter) {
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

export function updateEditorChapterRow(rowId, updater) {
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

export function insertEditorChapterRow(nextRow, anchorRowId, insertBefore = true) {
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

export function removeEditorChapterRow(rowId) {
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
    comments: state.editorChapter.activeRowId === rowId ? createEditorCommentsState() : state.editorChapter.comments,
    history: state.editorChapter.activeRowId === rowId ? createEditorHistoryState() : state.editorChapter.history,
  };
}

export function rowsWithEditorRowLifecycleState(rows, rowId, lifecycleState) {
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

export function markEditorRowsPersisted(rowUpdates, sourceWordCounts = null) {
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
