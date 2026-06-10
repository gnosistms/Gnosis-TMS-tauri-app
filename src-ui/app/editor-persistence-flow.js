import {
  resolveDirtyTrackedEditorRowIds,
  rowHasFieldChanges,
  rowHasPersistedChanges,
  rowTextContentEqual,
} from "./editor-row-persistence-model.js";
import {
  markEditorRowDirty,
  reconcileDirtyTrackedEditorRows,
} from "./editor-dirty-row-state.js";
import {
  EDITOR_ROW_FILTER_MODE_HAS_CONFLICT,
  normalizeEditorChapterFilterState,
} from "./editor-filters.js";
import { loadActiveEditorFieldHistory } from "./editor-history-flow.js";
import {
  applyOptimisticEditorHistoryEntry,
  createOptimisticEditorHistoryEntryFromRow,
  removeOptimisticEditorHistoryEntry,
} from "./editor-history-state.js";
import {
  applyEditorRowConflictDetected,
  applyEditorRowConflictResolvedWithRemote,
  applyEditorRowFieldValue,
  applyEditorRowMarkerSaved,
  applyEditorRowMarkerSaveFailed,
  applyEditorRowMarkerSaving,
  applyEditorRowPersistFailed,
  applyEditorRowPersistRequested,
  applyEditorRowPersistReset,
  applyEditorRowPersistSucceeded,
  applyEditorRowMergedWithRemote,
  applyEditorRowTextStyleSaved,
  applyEditorRowTextStyleSaveFailed,
  applyEditorRowTextStyleSaving,
  applyEditorRowTextStyleStaleSaved,
} from "./editor-persistence-state.js";
import {
  applyEditorChapterRowsUnreviewed,
  cancelEditorUnreviewAllModalState,
  openEditorUnreviewAllModalState,
} from "./editor-review-state.js";
import { findChapterContextById, selectedProjectsTeam } from "./project-context.js";
import {
  createEditorClearTranslationsModalState,
  createEditorFootnoteEditorState,
  createEditorImageCaptionEditorState,
  state,
} from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import { normalizeEditorRowTextStyle } from "./editor-row-text-style.js";
import { requestEditorOperation } from "./editor-operation-queue.js";
import { mergeEditorRowVersions } from "./editor-row-merge.js";
import {
  buildEditorFieldSelector,
  cloneRowFields,
  cloneRowFootnotes,
  findEditorRowById,
  normalizeFieldState,
} from "./editor-utils.js";
import {
  ensureEditorFootnoteEntry,
  nextEditorFootnoteMarker,
  normalizeEditorRowFootnotesForSave,
  serializeEditorFootnotesForLegacy,
} from "./editor-footnotes.js";
import {
  assertQueuedEditorRowsReady,
  invokeQueuedEditorWriteCommand,
} from "./editor-queued-write.js";
import {
  ensureEditorRowReadyForWrite,
  reloadEditorRowFromDisk,
} from "./editor-row-sync-flow.js";
import {
  assertCurrentEditorWritePermission,
  editorWriteLockIsActive,
  handleEditorPermissionDenied,
  invokeEditorWriteCommand,
} from "./editor-write-permission.js";
import {
  enqueueRepoWrite,
  projectRepoScope,
  publishRepoInvalidation,
} from "./repo-write-queue.js";
import {
  renderTranslateBodyPreservingViewport,
} from "./translate-viewport.js";

const pendingEditorDirtyRowScanFrameByRowId = new Map();
const pendingEditorRowCommitMetadataByRowId = new Map();
const PENDING_LOCAL_SAVE_STATUS_REFRESH_MS = 10_000;
let pendingEditorFootnoteOpenRequest = null;
let pendingEditorImageCaptionOpenRequest = null;

function normalizePendingEditorCommitMetadata(commitMetadata) {
  if (!commitMetadata || typeof commitMetadata !== "object") {
    return null;
  }

  const operation =
    typeof commitMetadata.operation === "string" ? commitMetadata.operation.trim() : "";
  const aiModel =
    typeof commitMetadata.aiModel === "string" ? commitMetadata.aiModel.trim() : "";
  if (!operation && !aiModel) {
    return null;
  }

  return {
    operation,
    aiModel,
  };
}

function takePendingEditorCommitMetadata(rowId) {
  if (!rowId) {
    return null;
  }

  const commitMetadata = pendingEditorRowCommitMetadataByRowId.get(rowId) ?? null;
  pendingEditorRowCommitMetadataByRowId.delete(rowId);
  return commitMetadata;
}

function editorRowTextCoalesceKey(chapterId, rowId) {
  return `rowText:${chapterId}:${rowId}`;
}

function editorChapterInvalidationKey(repoScope, chapterId) {
  return `editorChapter:${repoScope}:${chapterId}`;
}

function activeEditorHistoryLanguageForRow(rowId) {
  if (
    state.editorChapter?.activeRowId === rowId
    && typeof state.editorChapter?.activeLanguageCode === "string"
    && state.editorChapter.activeLanguageCode.trim()
  ) {
    return state.editorChapter.activeLanguageCode;
  }

  return "";
}

function statusNoteForEditorMarker(kind, enabled) {
  if (kind === "reviewed") {
    return enabled ? "Marked reviewed" : "Marked unreviewed";
  }
  if (kind === "please-check") {
    return enabled ? 'Marked "Please check"' : 'Removed "Please check"';
  }
  return "Updated markers";
}

function statusNoteForPendingLocalSave(operation) {
  const operationId = typeof operation?.operationId === "string" ? operation.operationId : "";
  const status = typeof operation?.status === "string" && operation.status.trim()
    ? operation.status.trim()
    : "queued";
  return operationId
    ? `Local save ${operationId}: ${status}.`
    : `Local save: ${status}.`;
}

function applyOptimisticHistoryForRow(render, rowId, languageCode, operation, options = {}) {
  if (!rowId || !languageCode || !operation?.operationId || !state.editorChapter?.chapterId) {
    return;
  }

  const row = findEditorRowById(rowId, state.editorChapter);
  const entry = createOptimisticEditorHistoryEntryFromRow(row, languageCode, {
    operationId: operation.operationId,
    coalesceKey: operation.coalesceKey,
    operationType: options.operationType,
    statusNote: options.statusNote,
    aiModel: options.aiModel,
    message: options.message,
  });
  const previousChapter = state.editorChapter;
  state.editorChapter = applyOptimisticEditorHistoryEntry(
    state.editorChapter,
    rowId,
    languageCode,
    entry,
  );
  if (state.editorChapter !== previousChapter) {
    render?.({ scope: "translate-sidebar" });
    schedulePendingLocalSaveStatusRefresh(render, operation.operationId);
  }
}

function schedulePendingLocalSaveStatusRefresh(render, operationId) {
  if (!operationId || typeof render !== "function") {
    return;
  }

  const setTimer =
    typeof window !== "undefined" && typeof window.setTimeout === "function"
      ? window.setTimeout.bind(window)
      : typeof globalThis.setTimeout === "function"
        ? globalThis.setTimeout.bind(globalThis)
        : null;
  if (!setTimer) {
    return;
  }

  setTimer(() => {
    const entries = Array.isArray(state.editorChapter?.history?.entries)
      ? state.editorChapter.history.entries
      : [];
    const stillPending = entries.some(
      (entry) => entry?.optimistic === true && entry.operationId === operationId,
    );
    if (stillPending) {
      render({ scope: "translate-sidebar" });
    }
  }, PENDING_LOCAL_SAVE_STATUS_REFRESH_MS);
}

function updateOptimisticHistoryStatusForOperation(render, operation) {
  if (!operation?.operationId || !state.editorChapter?.chapterId) {
    return;
  }

  const history = state.editorChapter.history;
  const entries = Array.isArray(history?.entries) ? history.entries : [];
  let changed = false;
  const nextEntries = entries.map((entry) => {
    if (entry?.optimistic !== true || entry.operationId !== operation.operationId) {
      return entry;
    }
    const statusNote = statusNoteForPendingLocalSave(operation);
    if (entry.statusNote === statusNote) {
      return entry;
    }
    changed = true;
    return {
      ...entry,
      statusNote,
    };
  });

  if (!changed) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    history: {
      ...history,
      entries: nextEntries,
    },
  };
  render?.({ scope: "translate-sidebar" });
}

function removeOptimisticHistoryForOperation(render, operation) {
  if (!operation?.operationId || !state.editorChapter?.chapterId) {
    return;
  }

  const previousChapter = state.editorChapter;
  state.editorChapter = removeOptimisticEditorHistoryEntry(
    state.editorChapter,
    operation.operationId,
  );
  if (state.editorChapter !== previousChapter) {
    render?.({ scope: "translate-sidebar" });
  }
}

function cloneQueueContextValue(value) {
  if (value == null) {
    return value;
  }
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function serializeFootnoteMapForLegacy(footnotes) {
  return Object.fromEntries(
    Object.entries(footnotes && typeof footnotes === "object" ? footnotes : {}).map(([code, value]) => [
      code,
      serializeEditorFootnotesForLegacy(value),
    ]),
  );
}

function rebaseRowTextInputForRun(operationValue) {
  const input = cloneQueueContextValue(operationValue?.input ?? {});
  if (operationValue?.rebaseBaseOnRun !== true) {
    return input;
  }

  if (state.editorChapter?.chapterId !== operationValue.chapterId) {
    return input;
  }

  const currentRow = findEditorRowById(operationValue.rowId, state.editorChapter);
  if (!currentRow) {
    return input;
  }

  input.baseFields = cloneRowFields(currentRow.persistedFields ?? currentRow.baseFields);
  input.baseFootnotes = serializeFootnoteMapForLegacy(currentRow.persistedFootnotes ?? currentRow.baseFootnotes);
  input.baseImageCaptions = cloneRowFields(currentRow.persistedImageCaptions ?? currentRow.baseImageCaptions);
  return input;
}

function normalizeEditorRowFootnotesBeforePersist(row) {
  if (!row || typeof row !== "object") {
    return row;
  }

  const fields = cloneRowFields(row.fields);
  const footnotes = cloneRowFootnotes(row.footnotes);
  let changed = false;
  for (const languageCode of new Set([...Object.keys(fields), ...Object.keys(footnotes)])) {
    const normalized = normalizeEditorRowFootnotesForSave(fields[languageCode] ?? "", footnotes[languageCode]);
    if (normalized.text !== (fields[languageCode] ?? "")) {
      fields[languageCode] = normalized.text;
      changed = true;
    }
    if (!rowTextContentEqual(
      {},
      { [languageCode]: footnotes[languageCode] ?? [] },
      {},
      {},
      { [languageCode]: normalized.footnotes },
      {},
    )) {
      footnotes[languageCode] = normalized.footnotes;
      changed = true;
    }
  }

  return changed ? { ...row, fields, footnotes } : row;
}

function lockConflictFilter() {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  const currentFilters = normalizeEditorChapterFilterState(state.editorChapter.filters);
  if (currentFilters.rowFilterMode === EDITOR_ROW_FILTER_MODE_HAS_CONFLICT) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    filters: {
      ...currentFilters,
      rowFilterMode: EDITOR_ROW_FILTER_MODE_HAS_CONFLICT,
    },
  };
}

function cancelScheduledDirtyRowScan(rowId) {
  const pendingScan = pendingEditorDirtyRowScanFrameByRowId.get(rowId);
  if (!pendingScan) {
    return;
  }

  if (Number.isInteger(pendingScan.frameId) && pendingScan.frameId !== 0) {
    window.cancelAnimationFrame(pendingScan.frameId);
  }
  if (Number.isInteger(pendingScan.verifyFrameId) && pendingScan.verifyFrameId !== 0) {
    window.cancelAnimationFrame(pendingScan.verifyFrameId);
  }

  pendingEditorDirtyRowScanFrameByRowId.delete(rowId);
}

function updateUnreviewAllModalError(message = "", render) {
  if (!state.editorChapter?.chapterId || !state.editorChapter?.unreviewAllModal?.isOpen) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    unreviewAllModal: {
      ...state.editorChapter.unreviewAllModal,
      status: "idle",
      error: message,
    },
  };
  render?.();
}

function updateClearTranslationsModalError(message = "", render) {
  if (!state.editorChapter?.chapterId || !state.editorChapter?.clearTranslationsModal?.isOpen) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    clearTranslationsModal: {
      ...state.editorChapter.clearTranslationsModal,
      status: "idle",
      error: message,
    },
  };
  render?.();
}

function rowHasPendingCommentWrite(rowId, chapterState = state.editorChapter) {
  if (!rowId || !chapterState?.chapterId) {
    return false;
  }

  const comments = chapterState.comments;
  const commentsRowId = typeof comments?.rowId === "string" ? comments.rowId : "";
  return commentsRowId === rowId && (comments?.status === "saving" || comments?.status === "deleting");
}

function scopedEditorRows(chapterState = state.editorChapter, options = {}) {
  const rowIdFilter = Array.isArray(options?.rowIds)
    ? new Set(options.rowIds.filter(Boolean))
    : null;
  const excludeRowId = typeof options?.excludeRowId === "string" ? options.excludeRowId : "";

  return (Array.isArray(chapterState?.rows) ? chapterState.rows : []).filter((row) => {
    const rowId = row?.rowId;
    return Boolean(rowId) && rowId !== excludeRowId && (!rowIdFilter || rowIdFilter.has(rowId));
  });
}

export function hasPendingEditorWrites(chapterState = state.editorChapter, options = {}) {
  return scopedEditorRows(chapterState, options).some((row) =>
    row?.saveStatus === "saving"
    || row?.markerSaveState?.status === "saving"
    || row?.textStyleSaveState?.status === "saving"
    || rowHasPersistedChanges(row)
    || rowHasPendingCommentWrite(row?.rowId, chapterState)
  );
}

function chapterNeedsRefreshBeforeMarkerBatchUpdate(chapterState = state.editorChapter) {
  if (chapterState?.deferredStructuralChanges === true) {
    return true;
  }

  return (Array.isArray(chapterState?.rows) ? chapterState.rows : []).some((row) =>
    row?.freshness === "stale"
    || row?.freshness === "staleDirty"
    || row?.freshness === "conflict"
    || row?.remotelyDeleted === true
  );
}

function formatUnreviewAllCount(count) {
  return count === 1 ? "1 row" : `${count} rows`;
}

function formatClearTranslationsCount(count) {
  return count === 1 ? "1 row" : `${count} rows`;
}

function nextChapterBaseCommitSha(payload, chapterState = state.editorChapter) {
  return typeof payload?.chapterBaseCommitSha === "string" && payload.chapterBaseCommitSha.trim()
    ? payload.chapterBaseCommitSha.trim()
    : chapterState?.chapterBaseCommitSha ?? null;
}

function editorChapterLanguageCodes(chapterState = state.editorChapter) {
  return (Array.isArray(chapterState?.languages) ? chapterState.languages : [])
    .map((language) => String(language?.code ?? "").trim())
    .filter(Boolean);
}

function normalizeClearTranslationsLanguageCodes(chapterState, languageCodes) {
  const validCodes = new Set(editorChapterLanguageCodes(chapterState));
  const selectedCodes = Array.isArray(languageCodes) ? languageCodes : [];
  const normalized = [];
  const seen = new Set();
  for (const rawCode of selectedCodes) {
    const code = String(rawCode ?? "").trim();
    if (!code || seen.has(code) || !validCodes.has(code)) {
      continue;
    }
    seen.add(code);
    normalized.push(code);
  }
  return normalized;
}

function clearTranslationsRowsForBatch(chapterState, languageCodes) {
  const selectedCodes = normalizeClearTranslationsLanguageCodes(chapterState, languageCodes);
  if (selectedCodes.length === 0) {
    return [];
  }

  return (Array.isArray(chapterState?.rows) ? chapterState.rows : []).flatMap((row) => {
    const rowId = String(row?.rowId ?? "").trim();
    if (!rowId || row?.lifecycleState === "deleted" || row?.remotelyDeleted === true) {
      return [];
    }

    const fields = {};
    for (const languageCode of selectedCodes) {
      if (String(row?.fields?.[languageCode] ?? "") !== "") {
        fields[languageCode] = "";
      }
    }

    return Object.keys(fields).length > 0
      ? [{
        rowId,
        fields,
        footnotes: {},
        imageCaptions: {},
      }]
      : [];
  });
}

function applyEditorChapterRowsTranslationsCleared(chapterState, languageCodes, rowIds) {
  const selectedCodes = normalizeClearTranslationsLanguageCodes(chapterState, languageCodes);
  const changedRowIds = new Set(Array.isArray(rowIds) ? rowIds.filter(Boolean) : []);
  if (!chapterState?.chapterId || selectedCodes.length === 0 || changedRowIds.size === 0) {
    return chapterState;
  }

  return {
    ...chapterState,
    rows: (Array.isArray(chapterState.rows) ? chapterState.rows : []).map((row) => {
      if (!changedRowIds.has(row?.rowId)) {
        return row;
      }

      const fields = cloneRowFields(row.fields);
      const persistedFields = cloneRowFields(row.persistedFields);
      const baseFields = cloneRowFields(row.baseFields);
      for (const languageCode of selectedCodes) {
        fields[languageCode] = "";
        persistedFields[languageCode] = "";
        baseFields[languageCode] = "";
      }

      return {
        ...row,
        fields,
        persistedFields,
        baseFields,
        saveStatus: "idle",
        saveError: "",
        freshness: row.freshness === "conflict" ? "conflict" : "fresh",
        conflictState: row.freshness === "conflict" ? row.conflictState : null,
      };
    }),
  };
}

function focusedEditorRowId() {
  const activeElement = document.activeElement;
  return typeof HTMLTextAreaElement === "function"
    && activeElement instanceof HTMLTextAreaElement
    && activeElement.matches("[data-editor-row-field]")
    ? activeElement.dataset.rowId ?? ""
    : "";
}

export function scheduleDirtyEditorRowScan(render, rowId, operations = {}) {
  if (!rowId || typeof window === "undefined") {
    return;
  }

  cancelScheduledDirtyRowScan(rowId);

  const pendingScan = {
    frameId: 0,
    verifyFrameId: 0,
  };
  pendingScan.frameId = window.requestAnimationFrame(() => {
    pendingScan.frameId = 0;
    pendingScan.verifyFrameId = window.requestAnimationFrame(() => {
      pendingEditorDirtyRowScanFrameByRowId.delete(rowId);
      if (focusedEditorRowId() === rowId) {
        return;
      }

      void flushDirtyEditorRows(render, operations, { rowIds: [rowId] });
    });
  });

  pendingEditorDirtyRowScanFrameByRowId.set(rowId, pendingScan);
}

export async function flushDirtyEditorRows(render, operations = {}, options = {}) {
  if (!state.editorChapter?.chapterId) {
    return true;
  }
  if (editorWriteLockIsActive(state.editorChapter)) {
    return true;
  }
  const waitForDurable = options?.waitForDurable !== false;

  const candidateRowIds = resolveDirtyTrackedEditorRowIds(state.editorChapter?.dirtyRowIds, {
    rowIds: Array.isArray(options?.rowIds) ? options.rowIds : null,
    excludeRowId: typeof options?.excludeRowId === "string" ? options.excludeRowId : "",
  });
  if (candidateRowIds.length === 0) {
    return !hasPendingEditorWrites(state.editorChapter, options);
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

    if (row.saveStatus === "conflict" || row.freshness === "conflict") {
      continue;
    }

    const queued = await persistEditorRowOnBlur(render, rowId, operations, {
      waitForDurable,
    });
    if (queued === false) {
      return false;
    }
  }

  reconcileDirtyTrackedEditorRows(candidateRowIds);
  if (!waitForDurable) {
    return true;
  }
  return !hasPendingEditorWrites(state.editorChapter, options);
}

export function updateEditorRowFieldValueForContentKind(
  rowId,
  languageCode,
  nextValue,
  contentKind = "field",
  options = {},
  operations = {},
) {
  const { updateEditorChapterRow } = operations;
  if (!rowId || !languageCode || typeof updateEditorChapterRow !== "function") {
    return;
  }

  updateEditorChapterRow(
    rowId,
    (row) => applyEditorRowFieldValue(row, languageCode, nextValue, contentKind, options),
  );
  markEditorRowDirty(rowId);
}

export function openEditorFootnote(render, rowId, languageCode, options = {}) {
  if (!rowId || !languageCode || !state.editorChapter?.chapterId) {
    return;
  }

  const row = findEditorRowById(rowId, state.editorChapter);
  const currentText = typeof row?.fields?.[languageCode] === "string"
    ? row.fields[languageCode]
    : String(row?.fields?.[languageCode] ?? "");
  let insertIndex = currentText.length;
  let selectionEnd = currentText.length;

  if (typeof document !== "undefined") {
    const activeElement = document.activeElement;
    const mainFieldSelector = buildEditorFieldSelector(rowId, languageCode, "field");
    if (
      activeElement instanceof HTMLTextAreaElement
      && activeElement.matches(mainFieldSelector)
    ) {
      insertIndex = Number.isInteger(activeElement.selectionStart)
        ? activeElement.selectionStart
        : currentText.length;
      selectionEnd = Number.isInteger(activeElement.selectionEnd)
        ? activeElement.selectionEnd
        : insertIndex;
    }
  }

  const marker = nextEditorFootnoteMarker(currentText, row?.footnotes?.[languageCode]);
  const markerText = `[${marker}]`;
  const separator = insertIndex >= currentText.length && currentText && !/\s$/.test(currentText) ? " " : "";
  const nextText =
    `${currentText.slice(0, insertIndex)}${separator}${markerText}${currentText.slice(selectionEnd)}`;

  const { updateEditorChapterRow } = options;
  if (typeof updateEditorChapterRow === "function") {
    updateEditorChapterRow(rowId, (currentRow) => {
      const withMarker = applyEditorRowFieldValue(currentRow, languageCode, nextText, "field");
      const footnotes = cloneRowFootnotes(withMarker.footnotes);
      footnotes[languageCode] = ensureEditorFootnoteEntry(footnotes[languageCode], marker);
      return {
        ...withMarker,
        footnotes,
      };
    });
    markEditorRowDirty(rowId);
  }

  pendingEditorFootnoteOpenRequest = {
    rowId,
    languageCode,
    marker,
  };

  state.editorChapter = {
    ...state.editorChapter,
    footnoteEditor: {
      rowId,
      languageCode,
      marker,
    },
  };
  renderTranslateBodyPreservingViewport(render, options?.viewportSnapshot ?? null);

  if (typeof window !== "undefined") {
    window.requestAnimationFrame(() => {
      const input = document.querySelector(
        `${buildEditorFieldSelector(rowId, languageCode, "footnote")}[data-footnote-marker="${CSS.escape(String(marker))}"]`,
      );
      if (input instanceof HTMLTextAreaElement) {
        input.focus({ preventScroll: true });
      }
      if (
        pendingEditorFootnoteOpenRequest?.rowId === rowId
        && pendingEditorFootnoteOpenRequest?.languageCode === languageCode
        && pendingEditorFootnoteOpenRequest?.marker === marker
      ) {
        pendingEditorFootnoteOpenRequest = null;
      }
    });
  }
}

export function openEditorImageCaption(render, rowId, languageCode, options = {}) {
  if (!rowId || !languageCode || !state.editorChapter?.chapterId) {
    return;
  }

  pendingEditorImageCaptionOpenRequest = {
    rowId,
    languageCode,
  };

  state.editorChapter = {
    ...state.editorChapter,
    imageCaptionEditor: {
      rowId,
      languageCode,
    },
  };
  renderTranslateBodyPreservingViewport(render, options?.viewportSnapshot ?? null);

  if (typeof window !== "undefined") {
    window.requestAnimationFrame(() => {
      const input = document.querySelector(buildEditorFieldSelector(rowId, languageCode, "image-caption"));
      if (input instanceof HTMLTextAreaElement) {
        input.focus({ preventScroll: true });
      }
      if (
        pendingEditorImageCaptionOpenRequest?.rowId === rowId
        && pendingEditorImageCaptionOpenRequest?.languageCode === languageCode
      ) {
        pendingEditorImageCaptionOpenRequest = null;
      }
    });
  }
}

export function collapseEmptyEditorFootnote(render, rowId, languageCode, options = {}) {
  if (!rowId || !languageCode || !state.editorChapter?.chapterId) {
    return;
  }

  const activeMarker = Number.parseInt(String(state.editorChapter.footnoteEditor?.marker ?? ""), 10);
  if (
    state.editorChapter.footnoteEditor?.rowId !== rowId
    || state.editorChapter.footnoteEditor?.languageCode !== languageCode
  ) {
    return;
  }
  if (
    pendingEditorFootnoteOpenRequest?.rowId === rowId
    && pendingEditorFootnoteOpenRequest?.languageCode === languageCode
    && (
      !Number.isInteger(activeMarker)
      || pendingEditorFootnoteOpenRequest?.marker === activeMarker
    )
  ) {
    return;
  }

  const row = findEditorRowById(rowId, state.editorChapter);
  const footnotes = cloneRowFootnotes(row?.footnotes);
  const normalizedRow = normalizeEditorRowFootnotesBeforePersist(row);
  const currentEntries = footnotes[languageCode] ?? [];
  const activeEntry = Number.isInteger(activeMarker)
    ? currentEntries.find((entry) => entry.marker === activeMarker) ?? null
    : null;
  const shouldKeepOpen =
    activeEntry
      ? activeEntry.text.trim().length > 0
      : currentEntries.some((entry) => entry.text.trim());
  if (shouldKeepOpen) {
    return;
  }

  if (normalizedRow !== row) {
    state.editorChapter = {
      ...state.editorChapter,
      rows: state.editorChapter.rows.map((currentRow) =>
        currentRow?.rowId === rowId ? normalizedRow : currentRow
      ),
    };
  }
  state.editorChapter = {
    ...state.editorChapter,
    footnoteEditor: createEditorFootnoteEditorState(),
  };
  renderTranslateBodyPreservingViewport(render, options?.viewportSnapshot ?? null);
}

export function collapseEditorImageCaption(render, rowId, languageCode) {
  if (!rowId || !languageCode || !state.editorChapter?.chapterId) {
    return;
  }

  if (
    state.editorChapter.imageCaptionEditor?.rowId !== rowId
    || state.editorChapter.imageCaptionEditor?.languageCode !== languageCode
  ) {
    return;
  }

  if (
    pendingEditorImageCaptionOpenRequest?.rowId === rowId
    && pendingEditorImageCaptionOpenRequest?.languageCode === languageCode
  ) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    imageCaptionEditor: createEditorImageCaptionEditorState(),
  };
  render?.({ scope: "translate-body" });
}

export async function updateEditorRowTextStyle(render, rowId, nextTextStyle, operations = {}) {
  const { updateEditorChapterRow } = operations;
  if (!rowId || typeof updateEditorChapterRow !== "function") {
    return;
  }

  const editorChapter = state.editorChapter;
  if (!editorChapter?.chapterId) {
    return;
  }

  const normalizedTextStyle = normalizeEditorRowTextStyle(nextTextStyle);
  let row = await ensureEditorRowReadyForWrite(render, rowId);
  if (!row) {
    return;
  }

  const previousTextStyle = normalizeEditorRowTextStyle(row.textStyle);
  if (previousTextStyle === normalizedTextStyle) {
    return;
  }

  if (rowHasPendingCommentWrite(rowId, editorChapter)) {
    showNoticeBadge("Finish saving comments before updating the row style.", render);
    return;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  const repoScope = projectRepoScope({ team, project: context?.project ?? null });
  if (!Number.isFinite(team?.installationId) || !context?.project?.name || !repoScope) {
    return;
  }

  try {
    assertCurrentEditorWritePermission({ actionKind: "sharedWrite", rowId });
  } catch (error) {
    if (!handleEditorPermissionDenied(error, render)) {
      showNoticeBadge(error?.message ?? String(error), render);
    }
    return;
  }

  if (rowHasFieldChanges(row)) {
    const queued = await persistEditorRowOnBlur(render, rowId, operations, { waitForDurable: false });
    if (queued === false || state.editorChapter?.chapterId !== editorChapter.chapterId) {
      return;
    }
  }

  const operationValue = {
    input: {
      installationId: team.installationId,
      projectId: context.project.id,
      repoName: context.project.name,
      chapterId: editorChapter.chapterId,
      rowId,
      textStyle: normalizedTextStyle,
    },
    chapterId: editorChapter.chapterId,
    rowId,
    nextTextStyle: normalizedTextStyle,
    previousTextStyle,
    permissionContext: {
      team: cloneQueueContextValue(team),
      project: cloneQueueContextValue(context.project),
      chapter: cloneQueueContextValue(context.chapter),
      row: cloneQueueContextValue(row),
      actionKind: "sharedWrite",
    },
  };

  const renderStyleChange = () => {
    render?.({ scope: "translate-body" });
    if (state.editorChapter?.activeRowId === rowId) {
      render?.({ scope: "translate-sidebar" });
    }
  };

  const requested = requestEditorOperation({
    repoScope,
    chapterScope: `${repoScope}:${editorChapter.chapterId}`,
    rowScope: `${repoScope}:${editorChapter.chapterId}:${rowId}`,
    coalesceKey: `textStyle:${editorChapter.chapterId}:${rowId}`,
    kind: "textStyle",
    value: operationValue,
    metadata: {
      projectId: context.project.id,
      chapterId: editorChapter.chapterId,
      rowId,
      textStyle: normalizedTextStyle,
    },
    invalidationKeys: [editorChapterInvalidationKey(repoScope, editorChapter.chapterId)],
  }, {
    applyOptimistic: (operation) => {
      if (state.editorChapter?.chapterId !== editorChapter.chapterId) {
        return;
      }
      updateEditorChapterRow(
        rowId,
        (currentRow) => applyEditorRowTextStyleSaving(currentRow, normalizedTextStyle),
      );
      markEditorRowDirty(rowId);
      applyOptimisticHistoryForRow(
        render,
        rowId,
        activeEditorHistoryLanguageForRow(rowId),
        operation,
        {
          operationType: "text-style",
          message: "Update row style",
        },
      );
      renderStyleChange();
    },
    run: async (operation) => {
      assertQueuedEditorRowsReady({
        chapterId: operation.value.chapterId,
        rowIds: [operation.value.rowId],
        forbidPendingText: true,
        message: "Refresh or resolve the row before updating its style.",
      });
      return invokeQueuedEditorWriteCommand(
        "update_gtms_editor_row_text_style",
        { input: operation.value.input },
        operation.value.permissionContext,
        render,
      );
    },
    onSuccess: (payload, operation) => {
      const value = operation?.value ?? operationValue;
      if (state.editorChapter?.chapterId !== value.chapterId) {
        return;
      }
      updateEditorChapterRow(
        value.rowId,
        (currentRow) => applyEditorRowTextStyleSaved(currentRow, payload),
      );
      state.editorChapter = {
        ...state.editorChapter,
        chapterBaseCommitSha: nextChapterBaseCommitSha(payload, state.editorChapter),
      };
      reconcileDirtyTrackedEditorRows([value.rowId]);
      renderStyleChange();

      if (state.editorChapter.activeRowId === value.rowId) {
        loadActiveEditorFieldHistory(render, {
          clearOptimisticOperationId: operation?.operationId,
        });
      }
    },
    onStaleSuccess: (payload, operation) => {
      const value = operation?.value ?? operationValue;
      if (state.editorChapter?.chapterId !== value.chapterId) {
        return;
      }
      updateEditorChapterRow(
        value.rowId,
        (currentRow) => applyEditorRowTextStyleStaleSaved(currentRow, payload),
      );
      state.editorChapter = {
        ...state.editorChapter,
        chapterBaseCommitSha: nextChapterBaseCommitSha(payload, state.editorChapter),
      };
      reconcileDirtyTrackedEditorRows([value.rowId]);
      renderStyleChange();
    },
    onError: (error, operation) => {
      const message = error instanceof Error ? error.message : String(error);
      const value = operation?.value ?? operationValue;
      if (state.editorChapter?.chapterId === value.chapterId) {
        removeOptimisticHistoryForOperation(render, operation);
        updateEditorChapterRow(
          value.rowId,
          (currentRow) => applyEditorRowTextStyleSaveFailed(
            currentRow,
            null,
            message,
          ),
        );
        reconcileDirtyTrackedEditorRows([value.rowId]);
        renderStyleChange();
      }
      showNoticeBadge(message || "The row style could not be saved.", render);
    },
  });
  requested.promise.catch(() => {});
}

export async function toggleEditorRowFieldMarker(
  render,
  rowId,
  languageCode,
  kind,
  operations = {},
  options = {},
) {
  const { updateEditorChapterRow } = operations;
  if (
    !rowId
    || !languageCode
    || (kind !== "reviewed" && kind !== "please-check")
    || typeof updateEditorChapterRow !== "function"
  ) {
    return;
  }

  const editorChapter = state.editorChapter;
  if (!editorChapter?.chapterId) {
    return;
  }

  if (!(await flushDirtyEditorRows(render, operations, { excludeRowId: rowId, waitForDurable: false }))) {
    showNoticeBadge("Finish saving the current row before updating review markers.", render);
    return;
  }

  if (state.editorChapter?.chapterId !== editorChapter.chapterId) {
    return;
  }

  const row = await ensureEditorRowReadyForWrite(render, rowId);
  if (!row) {
    return;
  }

  if (rowHasPendingCommentWrite(rowId, editorChapter)) {
    showNoticeBadge("Finish saving comments before updating review markers.", render);
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
  const repoScope = projectRepoScope({ team, project: context?.project ?? null });
  if (!Number.isFinite(team?.installationId) || !context?.project?.name || !repoScope) {
    return;
  }

  try {
    assertCurrentEditorWritePermission({ actionKind: "sharedWrite", rowId });
  } catch (error) {
    if (!handleEditorPermissionDenied(error, render)) {
      showNoticeBadge(error?.message ?? String(error), render);
    }
    return;
  }

  const previousFieldState = currentFieldState;
  const viewportSnapshot = options?.viewportSnapshot ?? null;

  if (rowHasFieldChanges(row)) {
    const queued = await persistEditorRowOnBlur(render, rowId, operations, { waitForDurable: false });
    if (queued === false || state.editorChapter?.chapterId !== editorChapter.chapterId) {
      return;
    }
  }

  const operationValue = {
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
    chapterId: editorChapter.chapterId,
    rowId,
    languageCode,
    kind,
    nextFieldState,
    previousFieldState,
    permissionContext: {
      team: cloneQueueContextValue(team),
      project: cloneQueueContextValue(context.project),
      chapter: cloneQueueContextValue(context.chapter),
      row: cloneQueueContextValue(row),
      actionKind: "sharedWrite",
    },
  };

  const requested = requestEditorOperation({
    repoScope,
    chapterScope: `${repoScope}:${editorChapter.chapterId}`,
    rowScope: `${repoScope}:${editorChapter.chapterId}:${rowId}`,
    coalesceKey: `marker:${editorChapter.chapterId}:${rowId}:${languageCode}:${kind}`,
    kind: "marker",
    value: operationValue,
    metadata: {
      projectId: context.project.id,
      chapterId: editorChapter.chapterId,
      rowId,
      languageCode,
      markerKind: kind,
    },
    invalidationKeys: [editorChapterInvalidationKey(repoScope, editorChapter.chapterId)],
  }, {
    applyOptimistic: (operation, previousOperation) => {
      if (state.editorChapter?.chapterId !== editorChapter.chapterId) {
        return;
      }
      markEditorRowDirty(rowId);
      updateEditorChapterRow(
        rowId,
        (currentRow) => applyEditorRowMarkerSaving(currentRow, languageCode, kind, nextFieldState),
      );
      applyOptimisticHistoryForRow(
        render,
        rowId,
        languageCode,
        operation,
        {
          operationType: "editor-marker",
          statusNote: statusNoteForEditorMarker(kind, nextEnabled),
          message: "Update review marker",
        },
      );
      if (previousOperation?.status === "queued") {
        reconcileDirtyTrackedEditorRows([rowId]);
      }
      renderTranslateBodyPreservingViewport(render, viewportSnapshot);
      render?.({ scope: "translate-sidebar" });
    },
    run: async (operation) => {
      assertQueuedEditorRowsReady({
        chapterId: operation.value.chapterId,
        rowIds: [operation.value.rowId],
        forbidPendingText: true,
        message: "Refresh or resolve the row before updating review markers.",
      });
      return invokeQueuedEditorWriteCommand(
        "update_gtms_editor_row_field_flag",
        { input: operation.value.input },
        operation.value.permissionContext,
        render,
      );
    },
    onSuccess: (payload, operation) => {
      const value = operation?.value ?? operationValue;
      if (state.editorChapter?.chapterId !== value.chapterId) {
        return;
      }
      updateEditorChapterRow(
        value.rowId,
        (currentRow) => applyEditorRowMarkerSaved(currentRow, value.languageCode, payload),
      );
      state.editorChapter = {
        ...state.editorChapter,
        chapterBaseCommitSha: nextChapterBaseCommitSha(payload, state.editorChapter),
      };
      reconcileDirtyTrackedEditorRows([value.rowId]);
      renderTranslateBodyPreservingViewport(render, viewportSnapshot);
      render?.({ scope: "translate-sidebar" });

      if (
        state.editorChapter.activeRowId === value.rowId
        && state.editorChapter.activeLanguageCode === value.languageCode
      ) {
        loadActiveEditorFieldHistory(render, {
          clearOptimisticOperationId: operation?.operationId,
        });
      }
    },
    onError: (error, operation) => {
      const message = error instanceof Error ? error.message : String(error);
      const value = operation?.value ?? operationValue;
      if (state.editorChapter?.chapterId === value.chapterId) {
        removeOptimisticHistoryForOperation(render, operation);
        updateEditorChapterRow(
          value.rowId,
          (currentRow) => applyEditorRowMarkerSaveFailed(
            currentRow,
            value.languageCode,
            value.previousFieldState,
            message,
          ),
        );
        reconcileDirtyTrackedEditorRows([value.rowId]);
        renderTranslateBodyPreservingViewport(render, viewportSnapshot);
        render?.({ scope: "translate-sidebar" });
      }
      showNoticeBadge(message || "The review marker could not be saved.", render);
    },
  });
  requested.promise.catch(() => {});
}

export function openEditorUnreviewAllModal(render) {
  const chapterState = state.editorChapter;
  const languageCode =
    typeof chapterState?.selectedTargetLanguageCode === "string"
      ? chapterState.selectedTargetLanguageCode.trim()
      : "";
  if (!chapterState?.chapterId || !languageCode) {
    return;
  }

  state.editorChapter = openEditorUnreviewAllModalState(chapterState, languageCode);
  render?.();
}

export function cancelEditorUnreviewAllModal(render) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  state.editorChapter = cancelEditorUnreviewAllModalState(state.editorChapter);
  render?.();
}

export function openEditorClearTranslationsModal(render) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    clearTranslationsModal: {
      ...createEditorClearTranslationsModalState(),
      isOpen: true,
    },
  };
  render?.();
}

export function cancelEditorClearTranslationsModal(render) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    clearTranslationsModal: createEditorClearTranslationsModalState(),
  };
  render?.();
}

export function updateEditorClearTranslationsLanguageSelection(render, languageCode, selected) {
  if (!state.editorChapter?.chapterId || !state.editorChapter?.clearTranslationsModal?.isOpen) {
    return;
  }

  const currentCodes = normalizeClearTranslationsLanguageCodes(
    state.editorChapter,
    state.editorChapter.clearTranslationsModal.selectedLanguageCodes,
  );
  const nextCodes = new Set(currentCodes);
  const code = String(languageCode ?? "").trim();
  if (selected) {
    nextCodes.add(code);
  } else {
    nextCodes.delete(code);
  }

  state.editorChapter = {
    ...state.editorChapter,
    clearTranslationsModal: {
      ...state.editorChapter.clearTranslationsModal,
      selectedLanguageCodes: normalizeClearTranslationsLanguageCodes(
        state.editorChapter,
        [...nextCodes],
      ),
      error: "",
    },
  };
  render?.();
}

export function reviewEditorClearTranslations(render) {
  if (!state.editorChapter?.chapterId || !state.editorChapter?.clearTranslationsModal?.isOpen) {
    return;
  }

  const selectedLanguageCodes = normalizeClearTranslationsLanguageCodes(
    state.editorChapter,
    state.editorChapter.clearTranslationsModal.selectedLanguageCodes,
  );
  if (selectedLanguageCodes.length === 0) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    clearTranslationsModal: {
      ...state.editorChapter.clearTranslationsModal,
      step: "confirm",
      selectedLanguageCodes,
      error: "",
    },
  };
  render?.();
}

export async function confirmEditorUnreviewAll(render, operations = {}) {
  const editorChapter = state.editorChapter;
  const modal = editorChapter?.unreviewAllModal;
  const languageCode =
    typeof modal?.languageCode === "string" ? modal.languageCode.trim() : "";
  if (!editorChapter?.chapterId || !modal?.isOpen || modal.status === "loading" || !languageCode) {
    return;
  }

  await flushDirtyEditorRows(render, operations, { waitForDurable: false });
  if (state.editorChapter?.chapterId !== editorChapter.chapterId) {
    return;
  }

  if (chapterNeedsRefreshBeforeMarkerBatchUpdate(state.editorChapter)) {
    updateUnreviewAllModalError(
      "Refresh or resolve the file before marking every translation unreviewed.",
      render,
    );
    return;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  const repoScope = projectRepoScope({ team, project: context?.project ?? null });
  if (!Number.isFinite(team?.installationId) || !context?.project?.name || !repoScope) {
    return;
  }

  try {
    assertCurrentEditorWritePermission({ actionKind: "sharedWrite" });
  } catch (error) {
    if (!handleEditorPermissionDenied(error, render)) {
      updateUnreviewAllModalError(error?.message ?? String(error), render);
      showNoticeBadge(error?.message ?? String(error), render);
    }
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    unreviewAllModal: {
      ...state.editorChapter.unreviewAllModal,
      status: "loading",
      error: "",
    },
  };
  render?.();

  const operationValue = {
    input: {
      installationId: team.installationId,
      projectId: context.project.id,
      repoName: context.project.name,
      chapterId: editorChapter.chapterId,
      languageCode,
    },
    chapterId: editorChapter.chapterId,
    languageCode,
    permissionContext: {
      team: cloneQueueContextValue(team),
      project: cloneQueueContextValue(context.project),
      chapter: cloneQueueContextValue(context.chapter),
      actionKind: "sharedWrite",
    },
  };

  const requested = requestEditorOperation({
    repoScope,
    chapterScope: `${repoScope}:${editorChapter.chapterId}`,
    kind: "unreviewAll",
    value: operationValue,
    metadata: {
      projectId: context.project.id,
      chapterId: editorChapter.chapterId,
      languageCode,
    },
    invalidationKeys: [editorChapterInvalidationKey(repoScope, editorChapter.chapterId)],
  }, {
    run: async (operation) => {
      assertQueuedEditorRowsReady({
        chapterId: operation.value.chapterId,
        includeAllRows: true,
        message: "Refresh or resolve the file before marking every translation unreviewed.",
      });
      return invokeQueuedEditorWriteCommand("clear_gtms_editor_reviewed_markers", {
        input: {
          ...operation.value.input,
        },
      }, operation.value.permissionContext, render);
    },
    onSuccess: (payload, operation) => {
      const value = operation?.value ?? operationValue;
      if (state.editorChapter?.chapterId !== value.chapterId) {
        return;
      }

      const changedRowIds = Array.isArray(payload?.rowIds) ? payload.rowIds.filter(Boolean) : [];
      const activeRowId = state.editorChapter.activeRowId;
      const activeLanguageCode = state.editorChapter.activeLanguageCode;
      state.editorChapter = {
        ...applyEditorChapterRowsUnreviewed(
          state.editorChapter,
          value.languageCode,
          changedRowIds,
        ),
        chapterBaseCommitSha: nextChapterBaseCommitSha(payload, state.editorChapter),
      };
      reconcileDirtyTrackedEditorRows(changedRowIds);
      render?.();

      if (
        changedRowIds.includes(activeRowId)
        && activeLanguageCode === value.languageCode
      ) {
        loadActiveEditorFieldHistory(render);
      }

      showNoticeBadge(
        changedRowIds.length > 0
          ? `Marked ${formatUnreviewAllCount(changedRowIds.length)} unreviewed.`
          : "All translations are already unreviewed.",
        render,
      );
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      updateUnreviewAllModalError(message, render);
      showNoticeBadge(message || "The reviewed markers could not be cleared.", render);
    },
  });
  requested.promise.catch(() => {});
}

export async function confirmEditorClearTranslations(render, operations = {}) {
  const editorChapter = state.editorChapter;
  const modal = editorChapter?.clearTranslationsModal;
  const selectedLanguageCodes = normalizeClearTranslationsLanguageCodes(
    editorChapter,
    modal?.selectedLanguageCodes,
  );
  if (
    !editorChapter?.chapterId
    || !modal?.isOpen
    || modal.status === "loading"
    || modal.step !== "confirm"
    || selectedLanguageCodes.length === 0
  ) {
    return;
  }

  await flushDirtyEditorRows(render, operations, { waitForDurable: false });
  if (state.editorChapter?.chapterId !== editorChapter.chapterId) {
    return;
  }

  if (chapterNeedsRefreshBeforeMarkerBatchUpdate(state.editorChapter)) {
    updateClearTranslationsModalError(
      "Refresh or resolve the file before clearing translations.",
      render,
    );
    return;
  }

  const rows = clearTranslationsRowsForBatch(state.editorChapter, selectedLanguageCodes);
  const team = selectedProjectsTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  const repoScope = projectRepoScope({ team, project: context?.project ?? null });
  if (!Number.isFinite(team?.installationId) || !context?.project?.name || !repoScope) {
    return;
  }

  try {
    assertCurrentEditorWritePermission({ actionKind: "sharedWrite" });
  } catch (error) {
    if (!handleEditorPermissionDenied(error, render)) {
      updateClearTranslationsModalError(error?.message ?? String(error), render);
      showNoticeBadge(error?.message ?? String(error), render);
    }
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    clearTranslationsModal: {
      ...state.editorChapter.clearTranslationsModal,
      status: "loading",
      error: "",
      selectedLanguageCodes,
    },
  };
  render?.();

  if (rows.length === 0) {
    const payload = {
      rowIds: [],
      wordCounts: state.editorChapter?.wordCounts ?? {},
      chapterBaseCommitSha: state.editorChapter?.chapterBaseCommitSha ?? null,
    };
    state.editorChapter = {
      ...state.editorChapter,
      wordCounts:
        payload?.wordCounts && typeof payload.wordCounts === "object"
          ? payload.wordCounts
          : state.editorChapter.wordCounts,
      chapterBaseCommitSha: nextChapterBaseCommitSha(payload, state.editorChapter),
      clearTranslationsModal: createEditorClearTranslationsModalState(),
    };
    render?.();
    showNoticeBadge("Selected translations are already empty.", render);
    return;
  }

  const operationValue = {
    input: {
      installationId: team.installationId,
      projectId: context.project.id,
      repoName: context.project.name,
      chapterId: editorChapter.chapterId,
      rows,
      commitMessage: `Clear ${selectedLanguageCodes.join(", ")} translations`,
      operation: "clear-translations",
    },
    chapterId: editorChapter.chapterId,
    selectedLanguageCodes,
    rows,
    permissionContext: {
      team: cloneQueueContextValue(team),
      project: cloneQueueContextValue(context.project),
      chapter: cloneQueueContextValue(context.chapter),
      actionKind: "sharedWrite",
    },
  };

  const requested = requestEditorOperation({
    repoScope,
    chapterScope: `${repoScope}:${editorChapter.chapterId}`,
    kind: "clearTranslations",
    value: operationValue,
    metadata: {
      projectId: context.project.id,
      chapterId: editorChapter.chapterId,
      rowIds: rows.map((row) => row.rowId).filter(Boolean),
      languageCodes: selectedLanguageCodes,
    },
    invalidationKeys: [editorChapterInvalidationKey(repoScope, editorChapter.chapterId)],
  }, {
    run: async (operation) => {
      assertQueuedEditorRowsReady({
        chapterId: operation.value.chapterId,
        includeAllRows: true,
        forbidPendingText: true,
        message: "Refresh or resolve the file before clearing translations.",
      });
      return invokeQueuedEditorWriteCommand("update_gtms_editor_row_fields_batch", {
        input: {
          ...operation.value.input,
        },
      }, operation.value.permissionContext, render);
    },
    onSuccess: (payload, operation) => {
      const value = operation?.value ?? operationValue;
      if (state.editorChapter?.chapterId !== value.chapterId) {
        return;
      }

      const changedRowIds = Array.isArray(payload?.rowIds) ? payload.rowIds.filter(Boolean) : [];
      const activeRowId = state.editorChapter.activeRowId;
      const activeLanguageCode = state.editorChapter.activeLanguageCode;
      state.editorChapter = {
        ...applyEditorChapterRowsTranslationsCleared(
          state.editorChapter,
          value.selectedLanguageCodes,
          changedRowIds,
        ),
        wordCounts:
          payload?.wordCounts && typeof payload.wordCounts === "object"
            ? payload.wordCounts
            : state.editorChapter.wordCounts,
        chapterBaseCommitSha: nextChapterBaseCommitSha(payload, state.editorChapter),
        clearTranslationsModal: createEditorClearTranslationsModalState(),
      };
      reconcileDirtyTrackedEditorRows(changedRowIds);
      render?.();

      if (
        changedRowIds.includes(activeRowId)
        && value.selectedLanguageCodes.includes(activeLanguageCode)
      ) {
        loadActiveEditorFieldHistory(render);
      }

      showNoticeBadge(
        changedRowIds.length > 0
          ? `Cleared translations in ${formatClearTranslationsCount(changedRowIds.length)}.`
          : "Selected translations are already empty.",
        render,
      );
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      updateClearTranslationsModalError(message, render);
      showNoticeBadge(message || "The translations could not be cleared.", render);
    },
  });
  requested.promise.catch(() => {});
}

export async function persistEditorRowOnBlur(render, rowId, operations = {}, options = {}) {
  return persistEditorRow(render, rowId, operations, options);
}

export async function resolveEditorRowConflict(render, rowId, resolution, operations = {}) {
  const { updateEditorChapterRow } = operations;
  if (!rowId || typeof updateEditorChapterRow !== "function") {
    return;
  }

  const row = findEditorRowById(rowId, state.editorChapter);
  if (!row?.conflictState) {
    return;
  }

  if (resolution === "use-remote") {
    if (row.importedConflictKind) {
      const team = selectedProjectsTeam();
      const context = findChapterContextById(state.editorChapter?.chapterId);
      const repoScope = projectRepoScope({ team, project: context?.project ?? null });
      if (Number.isFinite(team?.installationId) && context?.project?.name && context?.chapter?.id && repoScope) {
        try {
          await enqueueRepoWrite({
            scope: repoScope,
            kind: "editor:clearImportedConflict",
            operationType: "localMetadataWrite",
            priority: "blockingLocal",
            sourceScreen: "editor",
            metadata: {
              projectId: context.project.id,
              chapterId: context.chapter.id,
              rowId,
            },
            errorTarget: {
              repoScope,
              projectId: context.project.id,
              chapterId: context.chapter.id,
              rowId,
            },
            run: () => invokeEditorWriteCommand("clear_gtms_editor_imported_conflict", {
              input: {
                installationId: team.installationId,
                projectId: context.project.id,
                repoName: context.project.name,
                chapterId: context.chapter.id,
                rowId,
              },
            }, { render, actionKind: "sharedWrite", rowId }),
          });
          publishRepoInvalidation({
            keys: [editorChapterInvalidationKey(repoScope, context.chapter.id)],
            repoScope,
            sourceScreen: "editor",
            metadata: {
              projectId: context.project.id,
              chapterId: context.chapter.id,
              rowId,
              operation: "clearImportedConflict",
            },
          });
        } catch (error) {
          if (!handleEditorPermissionDenied(error, render)) {
            showNoticeBadge(error?.message ?? String(error), render);
          }
          return;
        }
      }
    }
    updateEditorChapterRow(rowId, (currentRow) => applyEditorRowConflictResolvedWithRemote(currentRow));
    reconcileDirtyTrackedEditorRows([rowId]);
    render?.({ scope: "translate-body" });
    render?.({ scope: "translate-sidebar" });
    return;
  }

  if (resolution !== "keep-local") {
    return;
  }

  await persistEditorRow(render, rowId, operations, {
    baseFieldsOverride: row.conflictState?.remoteRow?.fields ?? null,
    baseFootnotesOverride: row.conflictState?.remoteRow?.footnotes ?? null,
    baseImageCaptionsOverride: row.conflictState?.remoteRow?.imageCaptions ?? null,
  });
}

async function persistEditorRow(render, rowId, operations = {}, options = {}) {
  const {
    updateEditorChapterRow,
    applyEditorSelectionsToProjectState,
  } = operations;
  if (
    !rowId
    || !state.editorChapter?.chapterId
    || typeof updateEditorChapterRow !== "function"
    || typeof applyEditorSelectionsToProjectState !== "function"
  ) {
    return false;
  }

  const editorChapter = state.editorChapter;
  let row =
    options?.baseFieldsOverride || options?.baseFootnotesOverride || options?.baseImageCaptionsOverride
      ? findEditorRowById(rowId, state.editorChapter)
      : await ensureEditorRowReadyForWrite(render, rowId, {
        allowStaleDirty: true,
      });
  if (!row) {
    reconcileDirtyTrackedEditorRows([rowId]);
    return true;
  }

  const normalizedRow = normalizeEditorRowFootnotesBeforePersist(row);
  if (normalizedRow !== row) {
    row = updateEditorChapterRow(rowId, () => normalizedRow) ?? normalizedRow;
    render?.({ scope: "translate-body" });
  }

  if (!rowHasFieldChanges(row)) {
    pendingEditorRowCommitMetadataByRowId.delete(rowId);
    if (row.saveStatus !== "idle" || row.saveError) {
      updateEditorChapterRow(rowId, (currentRow) => applyEditorRowPersistReset(currentRow));
      render?.({ scope: "translate-sidebar" });
    }
    reconcileDirtyTrackedEditorRows([rowId]);
    return true;
  }

  const team = selectedProjectsTeam();
  const context = findChapterContextById(editorChapter.chapterId);
  const repoScope = projectRepoScope({ team, project: context?.project ?? null });
  if (!Number.isFinite(team?.installationId) || !context?.project?.name || !repoScope) {
    return false;
  }

  try {
    assertCurrentEditorWritePermission({ actionKind: "sharedWrite", rowId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (handleEditorPermissionDenied(error, render)) {
      return false;
    }
    updateEditorChapterRow(rowId, (currentRow) => applyEditorRowPersistFailed(currentRow, message));
    reconcileDirtyTrackedEditorRows([rowId]);
    render?.({ scope: "translate-sidebar" });
    showNoticeBadge(message || "The row could not be saved.", render);
    return false;
  }

  const commitMetadata =
    normalizePendingEditorCommitMetadata(options?.commitMetadata)
    ?? takePendingEditorCommitMetadata(rowId);
  const fieldsToPersist = cloneRowFields(row.fields);
  const footnotesToPersist = serializeFootnoteMapForLegacy(row.footnotes);
  const imageCaptionsToPersist = cloneRowFields(row.imageCaptions);
  const baseFields =
    options?.baseFieldsOverride && typeof options.baseFieldsOverride === "object"
      ? cloneRowFields(options.baseFieldsOverride)
      : cloneRowFields(row.baseFields);
  const baseFootnotes =
    options?.baseFootnotesOverride && typeof options.baseFootnotesOverride === "object"
      ? serializeFootnoteMapForLegacy(options.baseFootnotesOverride)
      : serializeFootnoteMapForLegacy(row.baseFootnotes);
  const baseImageCaptions =
    options?.baseImageCaptionsOverride && typeof options.baseImageCaptionsOverride === "object"
      ? cloneRowFields(options.baseImageCaptionsOverride)
      : cloneRowFields(row.baseImageCaptions);
  const input = {
    installationId: team.installationId,
    projectId: context.project.id,
    repoName: context.project.name,
    chapterId: editorChapter.chapterId,
    rowId,
    fields: fieldsToPersist,
    footnotes: footnotesToPersist,
    imageCaptions: imageCaptionsToPersist,
    baseFields,
    baseFootnotes,
    baseImageCaptions,
    ...(commitMetadata?.operation ? { operation: commitMetadata.operation } : {}),
    ...(commitMetadata?.aiModel ? { aiModel: commitMetadata.aiModel } : {}),
  };
  const rebaseBaseOnRun = !(
    options?.baseFieldsOverride
    || options?.baseFootnotesOverride
    || options?.baseImageCaptionsOverride
  );
  const operationValue = {
    input,
    chapterId: editorChapter.chapterId,
    rowId,
    fields: fieldsToPersist,
    footnotes: footnotesToPersist,
    imageCaptions: imageCaptionsToPersist,
    images: cloneQueueContextValue(row.images ?? {}),
    permissionContext: {
      team: cloneQueueContextValue(team),
      project: cloneQueueContextValue(context.project),
      chapter: cloneQueueContextValue(context.chapter),
      row: cloneQueueContextValue(row),
      actionKind: "sharedWrite",
    },
    rebaseBaseOnRun,
  };

  const applyRowTextSavePayload = (payload, operation, optionsForResult = {}) => {
    const value = operation?.value ?? operationValue;
    if (state.editorChapter?.chapterId !== value.chapterId) {
      return;
    }

    if (payload?.status === "skipped-conflict") {
      removeOptimisticHistoryForOperation(render, operation);
      render?.({ scope: "translate-sidebar" });
      return;
    }

    if (payload?.status === "conflict") {
      if (optionsForResult.isStale) {
        removeOptimisticHistoryForOperation(render, operation);
        const currentRowForStaleConflict = findEditorRowById(value.rowId, state.editorChapter);
        if (
          currentRowForStaleConflict
          && currentRowForStaleConflict.saveStatus !== "conflict"
          && currentRowForStaleConflict.freshness !== "conflict"
        ) {
          updateEditorChapterRow(
            value.rowId,
            (candidateRow) => applyEditorRowConflictDetected(candidateRow, payload, {
              localFields: candidateRow?.fields ?? value.fields,
              localFootnotes: candidateRow?.footnotes ?? value.footnotes,
              localImageCaptions: candidateRow?.imageCaptions ?? value.imageCaptions,
            }),
          );
          lockConflictFilter();
          render?.();
        }
        return;
      }

      const currentRowForMerge = findEditorRowById(value.rowId, state.editorChapter);
      const mergeResult = mergeEditorRowVersions({
        baseFields: payload?.baseFields ?? value.input?.baseFields ?? {},
        baseFootnotes: payload?.baseFootnotes ?? value.input?.baseFootnotes ?? {},
        baseImageCaptions: payload?.baseImageCaptions ?? value.input?.baseImageCaptions ?? {},
        baseImages: currentRowForMerge?.persistedImages ?? currentRowForMerge?.baseImages ?? {},
        baseFieldStates: currentRowForMerge?.persistedFieldStates ?? {},
        localFields: currentRowForMerge?.fields ?? value.fields,
        localFootnotes: currentRowForMerge?.footnotes ?? value.footnotes,
        localImageCaptions: currentRowForMerge?.imageCaptions ?? value.imageCaptions,
        localImages: currentRowForMerge?.images ?? value.images ?? {},
        localFieldStates: currentRowForMerge?.fieldStates ?? {},
        remoteRow: payload?.row,
      });
      if (mergeResult.status === "merged") {
        const updatedRow = updateEditorChapterRow(
          value.rowId,
          (candidateRow) => applyEditorRowMergedWithRemote(candidateRow, payload?.row, mergeResult),
        );
        state.editorChapter = {
          ...state.editorChapter,
          wordCounts:
            payload?.wordCounts && typeof payload.wordCounts === "object"
              ? payload.wordCounts
              : state.editorChapter.wordCounts,
          chapterBaseCommitSha: nextChapterBaseCommitSha(payload, state.editorChapter),
        };
        reconcileDirtyTrackedEditorRows([value.rowId]);
        applyEditorSelectionsToProjectState(state.editorChapter);
        render?.({ scope: "translate-sidebar" });
        removeOptimisticHistoryForOperation(render, operation);
        const mergedCurrentRow = findEditorRowById(value.rowId, state.editorChapter) ?? updatedRow;
        if (rowHasFieldChanges(mergedCurrentRow) && focusedEditorRowId() !== value.rowId) {
          void persistEditorRow(render, value.rowId, operations, { waitForDurable: false });
        }
        return;
      }

      if (rowTextContentEqual(
        value.fields,
        value.footnotes,
        value.imageCaptions,
        payload?.row?.fields,
        payload?.row?.footnotes,
        payload?.row?.imageCaptions,
      )) {
        updateEditorChapterRow(
          value.rowId,
          (currentRow) => applyEditorRowPersistSucceeded(currentRow, payload?.row, {
            fields: value.fields,
            footnotes: value.footnotes,
            imageCaptions: value.imageCaptions,
            images: value.images,
          }),
        );
        reconcileDirtyTrackedEditorRows([value.rowId]);
        render?.();
        removeOptimisticHistoryForOperation(render, operation);
        return;
      }

      removeOptimisticHistoryForOperation(render, operation);
      const currentRow = findEditorRowById(value.rowId, state.editorChapter);
      updateEditorChapterRow(
        value.rowId,
        (currentRow) => applyEditorRowConflictDetected(currentRow, payload, {
          localFields: currentRow?.fields ?? value.fields,
          localFootnotes: currentRow?.footnotes ?? value.footnotes,
          localImageCaptions: currentRow?.imageCaptions ?? value.imageCaptions,
        }),
      );
      lockConflictFilter();
      render?.();
      showNoticeBadge("Translation text changed on disk. Choose which version to keep.", render, 2400);
      return;
    }

    if (payload?.status === "deleted") {
      removeOptimisticHistoryForOperation(render, operation);
      void reloadEditorRowFromDisk(render, value.rowId, { suppressNotice: false }).then(() => {
        reconcileDirtyTrackedEditorRows([value.rowId]);
      });
      return;
    }

    const updatedRow = updateEditorChapterRow(
      value.rowId,
      (currentRow) => applyEditorRowPersistSucceeded(currentRow, payload?.row, {
        fields: value.fields,
        footnotes: value.footnotes,
        imageCaptions: value.imageCaptions,
        images: value.images,
      }),
    );

    state.editorChapter = {
      ...state.editorChapter,
      wordCounts:
        payload?.wordCounts && typeof payload.wordCounts === "object"
          ? payload.wordCounts
          : state.editorChapter.wordCounts,
      chapterBaseCommitSha: nextChapterBaseCommitSha(payload, state.editorChapter),
    };
    reconcileDirtyTrackedEditorRows([value.rowId]);
    applyEditorSelectionsToProjectState(state.editorChapter);
    removeOptimisticHistoryForOperation(render, operation);
    render?.({ scope: "translate-sidebar" });
    if (!optionsForResult.isStale && state.editorChapter.activeRowId === value.rowId) {
      loadActiveEditorFieldHistory(render, {
        clearOptimisticOperationId: operation?.operationId,
      });
    }

    if (!optionsForResult.isStale && updatedRow?.saveStatus === "dirty" && focusedEditorRowId() !== value.rowId) {
      void persistEditorRow(render, value.rowId, operations, { waitForDurable: false });
    }
  };

  const requested = requestEditorOperation({
    repoScope,
    chapterScope: `${repoScope}:${editorChapter.chapterId}`,
    rowScope: `${repoScope}:${editorChapter.chapterId}:${rowId}`,
    coalesceKey: editorRowTextCoalesceKey(editorChapter.chapterId, rowId),
    kind: "rowText",
    value: operationValue,
    metadata: {
      projectId: context.project.id,
      chapterId: editorChapter.chapterId,
      rowId,
    },
    invalidationKeys: [editorChapterInvalidationKey(repoScope, editorChapter.chapterId)],
  }, {
    applyOptimistic: (operation) => {
      if (state.editorChapter?.chapterId !== editorChapter.chapterId) {
        return;
      }
      updateEditorChapterRow(rowId, (currentRow) => applyEditorRowPersistRequested(currentRow));
      applyOptimisticHistoryForRow(
        render,
        rowId,
        activeEditorHistoryLanguageForRow(rowId),
        operation,
        {
          operationType: commitMetadata?.operation || "editor-update",
          aiModel: commitMetadata?.aiModel || null,
          message: "Update row text",
          statusNote: statusNoteForPendingLocalSave(operation),
        },
      );
      render?.({ scope: "translate-sidebar" });
    },
    run: async (operation) => {
      const currentRow = findEditorRowById(operation.value?.rowId, state.editorChapter);
      if (currentRow?.saveStatus === "conflict" || currentRow?.freshness === "conflict") {
        return {
          status: "skipped-conflict",
          row: currentRow,
        };
      }
      return invokeQueuedEditorWriteCommand(
        "update_gtms_editor_row_fields",
        { input: rebaseRowTextInputForRun(operation.value) },
        operation.value.permissionContext,
        render,
      );
    },
    onSuccess: (payload, operation) => applyRowTextSavePayload(payload, operation),
    onStaleSuccess: (payload, operation) => applyRowTextSavePayload(payload, operation, { isStale: true }),
    onError: (error, operation) => {
      const message = error instanceof Error ? error.message : String(error);
      const value = operation?.value ?? operationValue;
      if (state.editorChapter?.chapterId === value.chapterId) {
        removeOptimisticHistoryForOperation(render, operation);
        updateEditorChapterRow(value.rowId, (currentRow) => applyEditorRowPersistFailed(currentRow, message));
        reconcileDirtyTrackedEditorRows([value.rowId]);
        render?.({ scope: "translate-sidebar" });
      }
      showNoticeBadge(message || "The row could not be saved.", render);
    },
    onStatusChange: (operation) => updateOptimisticHistoryStatusForOperation(render, operation),
  });

  requested.promise.catch(() => {});
  if (options?.waitForDurable === false) {
    return true;
  }

  try {
    await requested.promise;
  } catch {}
  return true;
}
