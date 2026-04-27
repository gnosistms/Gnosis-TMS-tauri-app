import { requireBrokerSession } from "./auth-flow.js";
import { rowHasUnresolvedEditorConflict } from "./editor-conflicts.js";
import {
  EDITOR_ROW_FILTER_MODE_HAS_CONFLICT,
  normalizeEditorChapterFilterState,
} from "./editor-filters.js";
import { loadActiveEditorFieldHistory } from "./editor-history-flow.js";
import {
  flushDirtyEditorRows as flushDirtyEditorRowsFlow,
  hasPendingEditorWrites as hasPendingEditorWritesFlow,
} from "./editor-persistence-flow.js";
import {
  applyEditorRowConflictDetected,
  applyEditorRowMergedWithRemote,
} from "./editor-persistence-state.js";
import { mergeDirtyEditorRowWithRemote } from "./editor-row-merge.js";
import { reloadSelectedChapterEditorData } from "./editor-chapter-reload.js";
import { rowHasPersistedChanges } from "./editor-row-persistence-model.js";
import { markEditorRowsStale, reloadEditorRowFromDisk } from "./editor-row-sync-flow.js";
import {
  applyEditorSelectionsToProjectState,
  updateEditorChapterRow,
} from "./editor-state-flow.js";
import { findChapterContextById, selectedProjectsTeam } from "./project-context.js";
import { hideNavigationLoadingModal, showNavigationLoadingModal } from "./navigation-loading.js";
import { invoke, waitForNextPaint } from "./runtime.js";
import { lockScreenScrollSnapshot, unlockScreenScrollSnapshot } from "./scroll-state.js";
import { state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import { classifySyncError } from "./sync-error.js";
import { handleSyncFailure } from "./sync-recovery.js";
import { findEditorRowById } from "./editor-utils.js";

const EDITOR_SYNC_IDLE_MS = 10_000;
const EDITOR_SYNC_REMOTE_INTERVAL_MS = 180_000;
const EDITOR_SYNC_AUTO_REFRESH_ROW_LIMIT = 8;
const EDITOR_SYNC_BLOCKING_RELOAD_TITLE = "Synchronizing with GitHub";
const EDITOR_SYNC_BLOCKING_RELOAD_MESSAGE = "Many rows changed, so this file is being reloaded.";
const PROJECT_REPO_SYNC_STATUS_IMPORTED_EDITOR_CONFLICTS = "importedEditorConflicts";

const editorBackgroundSyncSession = {
  key: "",
  intervalId: 0,
  lastScrollAt: 0,
  lastSyncedHeadSha: null,
  pendingSync: null,
};

function normalizeHeadSha(headSha) {
  return typeof headSha === "string" && headSha.trim()
    ? headSha.trim()
    : null;
}

function syncResultMatchesCurrentChapterHead(syncResult, chapterState = state.editorChapter) {
  const currentHeadSha = normalizeHeadSha(chapterState?.chapterBaseCommitSha);
  const oldHeadSha = normalizeHeadSha(syncResult?.oldHeadSha);
  return !currentHeadSha || !oldHeadSha || currentHeadSha === oldHeadSha;
}

function currentSessionKey() {
  if (state.screen !== "translate" || !state.editorChapter?.chapterId) {
    return "";
  }

  return `${state.editorChapter.projectId ?? ""}:${state.editorChapter.chapterId}`;
}

function sessionMatchesCurrentEditor() {
  return editorBackgroundSyncSession.key && editorBackgroundSyncSession.key === currentSessionKey();
}

function persistenceOperations() {
  return {
    updateEditorChapterRow,
    applyEditorSelectionsToProjectState,
  };
}

function activeEditorSyncInput() {
  const team = selectedProjectsTeam();
  const context = findChapterContextById(state.editorChapter?.chapterId);
  if (!Number.isFinite(team?.installationId) || !context?.project?.name || !context?.chapter?.id) {
    return null;
  }

  return {
    installationId: team.installationId,
    projectId: context.project.id,
    repoName: context.project.name,
    fullName: context.project.fullName,
    repoId: Number.isFinite(context.project.repoId) ? context.project.repoId : null,
    defaultBranchName: context.project.defaultBranchName ?? "main",
    defaultBranchHeadOid: context.project.defaultBranchHeadOid ?? null,
    chapterId: context.chapter.id,
  };
}

function clearBackgroundSyncInterval() {
  if (Number.isInteger(editorBackgroundSyncSession.intervalId) && editorBackgroundSyncSession.intervalId !== 0) {
    window.clearInterval(editorBackgroundSyncSession.intervalId);
  }
  editorBackgroundSyncSession.intervalId = 0;
}

function setEditorBackgroundSyncState(status, error = "") {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    backgroundSyncStatus: status,
    backgroundSyncError: error,
  };
}

function normalizeSyncRowIds(rowIds) {
  if (!Array.isArray(rowIds) || rowIds.length === 0) {
    return [];
  }

  const normalizedRowIds = [];
  const seen = new Set();
  rowIds.forEach((rowId) => {
    const normalizedRowId =
      typeof rowId === "string" && rowId.trim()
        ? rowId.trim()
        : "";
    if (!normalizedRowId || seen.has(normalizedRowId)) {
      return;
    }

    seen.add(normalizedRowId);
    normalizedRowIds.push(normalizedRowId);
  });

  return normalizedRowIds;
}

function editorControlOwnsRow(editorState, rowId) {
  return (
    editorState
    && typeof editorState === "object"
    && editorState.rowId === rowId
  );
}

function rowHasProtectedEditorState(rowId, chapterState = state.editorChapter) {
  if (!rowId || !chapterState?.chapterId) {
    return false;
  }

  return (
    chapterState.activeRowId === rowId
    || editorControlOwnsRow(chapterState.mainFieldEditor, rowId)
    || editorControlOwnsRow(chapterState.footnoteEditor, rowId)
    || editorControlOwnsRow(chapterState.imageCaptionEditor, rowId)
    || editorControlOwnsRow(chapterState.imageEditor, rowId)
  );
}

function rowIsSafeForBackgroundRefresh(rowId, chapterState = state.editorChapter) {
  if (!rowId || !chapterState?.chapterId) {
    return false;
  }

  const row = findEditorRowById(rowId, chapterState);
  if (!row || row.lifecycleState === "deleted") {
    return false;
  }

  if (rowHasProtectedEditorState(rowId, chapterState)) {
    return false;
  }

  if (rowHasPersistedChanges(row) || row.freshness === "staleDirty") {
    return false;
  }

  if (rowHasUnresolvedEditorConflict(row)) {
    return false;
  }

  if (row.remotelyDeleted === true) {
    return false;
  }

  return true;
}

function collectSafeBackgroundRefreshRowIds(syncResult = {}, chapterState = state.editorChapter) {
  const insertedRowIds = normalizeSyncRowIds(syncResult?.insertedRowIds);
  if (insertedRowIds.length > 0) {
    return [];
  }

  const changedRowIds = normalizeSyncRowIds(syncResult?.changedRowIds);
  if (changedRowIds.length === 0) {
    return [];
  }

  return changedRowIds.filter((rowId) => rowIsSafeForBackgroundRefresh(rowId, chapterState));
}

function rowCanAttemptDirtyBackgroundMerge(rowId, chapterState = state.editorChapter) {
  const row = findEditorRowById(rowId, chapterState);
  if (!row || row.lifecycleState === "deleted") {
    return false;
  }

  return (
    row.freshness === "staleDirty"
    && row.remotelyDeleted !== true
    && !rowHasUnresolvedEditorConflict(row)
  );
}

function hasBlockingPendingWritesForBackgroundSync(chapterState = state.editorChapter) {
  if (!chapterState?.chapterId) {
    return false;
  }

  const hasBlockingRowWrite = (Array.isArray(chapterState.rows) ? chapterState.rows : []).some((row) =>
    row?.saveStatus === "saving"
    || row?.markerSaveState?.status === "saving"
    || row?.textStyleSaveState?.status === "saving",
  );
  if (hasBlockingRowWrite) {
    return true;
  }

  return (
    chapterState.comments?.status === "saving"
    || chapterState.comments?.status === "deleting"
  );
}

function buildBackgroundSyncHandlingSummary(
  syncResult = {},
  chapterState = state.editorChapter,
  options = {},
) {
  const changedRowIds = normalizeSyncRowIds(syncResult?.changedRowIds);
  const deletedRowIds = normalizeSyncRowIds(syncResult?.deletedRowIds);
  const insertedRowIds = normalizeSyncRowIds(syncResult?.insertedRowIds);
  const canPerformBlockingReload = options?.allowBlockingReload !== false;
  const chapterLanguagesChanged = syncResult?.chapterLanguagesChanged === true;
  const deletedRowsAllowBlockingReload =
    canPerformBlockingReload
    && deletedRowIds.length > 0
    && deletedRowIds.every((rowId) => rowIsSafeForBackgroundRefresh(rowId, chapterState));
  const blockingReloadReason =
    canPerformBlockingReload && chapterLanguagesChanged ? "chapter-languages"
      : canPerformBlockingReload && insertedRowIds.length > 0 ? "inserted-rows"
      : deletedRowsAllowBlockingReload ? "deleted-rows"
        : canPerformBlockingReload && changedRowIds.length > EDITOR_SYNC_AUTO_REFRESH_ROW_LIMIT ? "large-batch"
          : null;
  const requiresBlockingReload = blockingReloadReason !== null;
  const safeRefreshRowIds = requiresBlockingReload
    ? []
    : collectSafeBackgroundRefreshRowIds(syncResult, chapterState);
  const safeRefreshRowIdSet = new Set(safeRefreshRowIds);
  const deferredChangedRowIds = changedRowIds.filter((rowId) => !safeRefreshRowIdSet.has(rowId));

  return {
    changedRowIds,
    deletedRowIds,
    insertedRowIds,
    chapterLanguagesChanged,
    safeRefreshRowIds,
    deferredChangedRowIds,
    requiresBlockingReload,
    blockingReloadReason,
    requiresChapterReload:
      requiresBlockingReload
      || chapterLanguagesChanged
      || deletedRowIds.length > 0
      || insertedRowIds.length > 0
      || deferredChangedRowIds.length > 0,
  };
}

function updatedHandlingSummaryWithResolvedDeferredRows(handlingSummary, handledDeferredRowIds = []) {
  const handledRowIdSet = new Set(normalizeSyncRowIds(handledDeferredRowIds));
  const deferredChangedRowIds = handlingSummary.deferredChangedRowIds.filter(
    (rowId) => !handledRowIdSet.has(rowId),
  );

  return {
    ...handlingSummary,
    deferredChangedRowIds,
    requiresChapterReload:
      handlingSummary.requiresBlockingReload
      || handlingSummary.chapterLanguagesChanged
      || handlingSummary.deletedRowIds.length > 0
      || handlingSummary.insertedRowIds.length > 0
      || deferredChangedRowIds.length > 0,
  };
}

async function reloadBackgroundSyncSafeRows(render, rowIds) {
  const successfulRowIds = [];
  for (const rowId of normalizeSyncRowIds(rowIds)) {
    const updatedRow = await reloadEditorRowFromDisk(render, rowId, {
      suppressNotice: true,
    });
    if (updatedRow?.lifecycleState === "active") {
      successfulRowIds.push(rowId);
    }
  }

  return successfulRowIds;
}

function shouldRerenderBodyAfterSync(markResult, refreshedRowIds = []) {
  if (!markResult?.visibleStateChanged) {
    return false;
  }

  if (markResult.deferredStructuralChanged === true) {
    return true;
  }

  const refreshedRowIdSet = new Set(normalizeSyncRowIds(refreshedRowIds));
  return (Array.isArray(markResult.stateChangedRowIds) ? markResult.stateChangedRowIds : [])
    .some((rowId) => !refreshedRowIdSet.has(rowId));
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

async function loadLatestBackgroundSyncRowSnapshot(rowId) {
  const input = activeEditorSyncInput();
  if (!input || !rowId) {
    return null;
  }

  return invoke("load_gtms_editor_row", {
    input: {
      installationId: input.installationId,
      projectId: input.projectId,
      repoName: input.repoName,
      chapterId: input.chapterId,
      rowId,
    },
  });
}

async function resolveBackgroundSyncDirtyRows(render, rowIds = []) {
  const mergedRowIds = [];
  const conflictedRowIds = [];

  for (const rowId of normalizeSyncRowIds(rowIds)) {
    if (!sessionMatchesCurrentEditor()) {
      break;
    }

    const row = findEditorRowById(rowId, state.editorChapter);
    if (!rowCanAttemptDirtyBackgroundMerge(rowId, state.editorChapter) || !row) {
      continue;
    }

    const payload = await loadLatestBackgroundSyncRowSnapshot(rowId);
    if (!sessionMatchesCurrentEditor()) {
      break;
    }

    if (!payload?.row || payload.row.lifecycleState === "deleted") {
      continue;
    }

    const currentRow = findEditorRowById(rowId, state.editorChapter);
    if (!currentRow) {
      continue;
    }

    const mergeResult = mergeDirtyEditorRowWithRemote(currentRow, payload.row);
    if (mergeResult.status === "merged") {
      updateEditorChapterRow(
        rowId,
        (candidateRow) => applyEditorRowMergedWithRemote(candidateRow, payload.row, mergeResult),
      );
      mergedRowIds.push(rowId);
      continue;
    }

    if (mergeResult.status === "conflict") {
      updateEditorChapterRow(
        rowId,
        (candidateRow) => applyEditorRowConflictDetected(candidateRow, {
          row: payload.row,
          baseFields: currentRow.baseFields,
          baseFootnotes: currentRow.baseFootnotes,
          baseImageCaptions: currentRow.baseImageCaptions,
          conflictRemoteVersion: payload?.rowVersion ?? null,
        }, {
          localFields: currentRow.fields,
          localFootnotes: currentRow.footnotes,
          localImageCaptions: currentRow.imageCaptions,
          remoteVersion: payload?.rowVersion ?? null,
        }),
      );
      conflictedRowIds.push(rowId);
    }
  }

  const handledRowIds = [...mergedRowIds, ...conflictedRowIds];
  if (conflictedRowIds.length > 0) {
    lockConflictFilter();
  }
  if (handledRowIds.length > 0) {
    render?.({
      scope: "translate-visible-rows",
      rowIds: handledRowIds,
      reason: mergedRowIds.length > 0 && conflictedRowIds.length > 0
        ? "background-sync-dirty-merge"
        : mergedRowIds.length > 0
          ? "background-sync-dirty-merge"
          : "background-sync-conflict",
    });
    if (handledRowIds.includes(state.editorChapter?.activeRowId ?? "")) {
      render?.({ scope: "translate-sidebar" });
      loadActiveEditorFieldHistory(render);
    }
  }

  return {
    mergedRowIds,
    conflictedRowIds,
    handledRowIds,
  };
}

function createBackgroundSyncResult(overrides = {}) {
  return {
    payload: null,
    matchedCurrentHead: true,
    refreshedRowIds: [],
    shouldRerenderBody: false,
    requiresChapterReload: false,
    requiresBlockingReload: false,
    performedBlockingReload: false,
    blockingReloadReason: null,
    handlingSummary: buildBackgroundSyncHandlingSummary(),
    ...overrides,
  };
}

async function performBlockingChapterReload(render) {
  if (!sessionMatchesCurrentEditor()) {
    return false;
  }

  const navigationLoadingToken = showNavigationLoadingModal(
    EDITOR_SYNC_BLOCKING_RELOAD_TITLE,
    EDITOR_SYNC_BLOCKING_RELOAD_MESSAGE,
  );
  lockScreenScrollSnapshot("translate");
  render?.();

  try {
    await reloadSelectedChapterEditorData(render, { preserveVisibleRows: true });
    if (!sessionMatchesCurrentEditor()) {
      return false;
    }

    await waitForNextPaint();
    return state.editorChapter?.status === "ready";
  } finally {
    unlockScreenScrollSnapshot("translate");
    if (hideNavigationLoadingModal(navigationLoadingToken)) {
      render?.();
    }
  }
}

async function runEditorBackgroundSync(render, options = {}) {
  if (!sessionMatchesCurrentEditor()) {
    return createBackgroundSyncResult();
  }

  if (state.offline?.isEnabled === true) {
    return createBackgroundSyncResult();
  }

  const input = activeEditorSyncInput();
  if (!input) {
    return createBackgroundSyncResult();
  }

  if (options.skipDirtyFlush !== true) {
    if (await flushDirtyEditorRowsFlow(render, persistenceOperations()) === false) {
      return createBackgroundSyncResult();
    }
  }

  if (hasBlockingPendingWritesForBackgroundSync()) {
    return createBackgroundSyncResult();
  }

  const previousSyncStatus = state.editorChapter?.backgroundSyncStatus ?? "";
  const previousSyncError = state.editorChapter?.backgroundSyncError ?? "";
  const hadVisibleErrorBanner = previousSyncStatus === "error" && Boolean(previousSyncError);
  setEditorBackgroundSyncState("syncing", "");

  try {
    const payload = await invoke("sync_gtms_project_editor_repo", {
      input,
      sessionToken: requireBrokerSession(),
    });

    if (!sessionMatchesCurrentEditor()) {
      return createBackgroundSyncResult();
    }

    const matchesCurrentHead = syncResultMatchesCurrentChapterHead(payload);
    const hasDirtyRowsRemaining = hasPendingEditorWritesFlow();
    const handlingSummary = buildBackgroundSyncHandlingSummary(payload, state.editorChapter, {
      allowBlockingReload: !hasDirtyRowsRemaining,
    });
    const repoSyncStatus =
      typeof payload?.repoSyncStatus === "string" && payload.repoSyncStatus.trim()
        ? payload.repoSyncStatus.trim()
        : "";
    const affectedChapterIds = Array.isArray(payload?.affectedChapterIds)
      ? payload.affectedChapterIds.filter((chapterId) => typeof chapterId === "string" && chapterId.trim())
      : [];
    const currentChapterHasImportedGitConflicts =
      repoSyncStatus === PROJECT_REPO_SYNC_STATUS_IMPORTED_EDITOR_CONFLICTS
      && affectedChapterIds.includes(input.chapterId);
    if (matchesCurrentHead) {
      editorBackgroundSyncSession.lastSyncedHeadSha =
        normalizeHeadSha(payload?.newHeadSha)
        ?? normalizeHeadSha(payload?.oldHeadSha)
        ?? editorBackgroundSyncSession.lastSyncedHeadSha;
    }

    if (repoSyncStatus === PROJECT_REPO_SYNC_STATUS_IMPORTED_EDITOR_CONFLICTS) {
      const performedBlockingReload = currentChapterHasImportedGitConflicts
        ? await performBlockingChapterReload(render)
        : false;
      setEditorBackgroundSyncState("idle", "");
      return createBackgroundSyncResult({
        payload: payload ?? null,
        matchedCurrentHead: matchesCurrentHead,
        refreshedRowIds: [],
        shouldRerenderBody: false,
        requiresChapterReload: currentChapterHasImportedGitConflicts,
        requiresBlockingReload: currentChapterHasImportedGitConflicts,
        performedBlockingReload,
        blockingReloadReason: currentChapterHasImportedGitConflicts
          ? "imported-editor-conflicts"
          : null,
        handlingSummary,
      });
    }

    if (!matchesCurrentHead) {
      setEditorBackgroundSyncState("idle", "");
      if (hadVisibleErrorBanner && options.suppressConservativeRerender !== true) {
        render?.({ scope: "translate-body" });
      }
      return createBackgroundSyncResult({
        payload: payload ?? null,
        matchedCurrentHead: false,
        shouldRerenderBody: hadVisibleErrorBanner,
        requiresChapterReload: payload !== null,
        requiresBlockingReload: handlingSummary.requiresBlockingReload,
        performedBlockingReload: false,
        blockingReloadReason: handlingSummary.blockingReloadReason,
        handlingSummary,
      });
    }

    if (handlingSummary.requiresBlockingReload === true) {
      const performedBlockingReload = await performBlockingChapterReload(render);
      setEditorBackgroundSyncState("idle", "");
      return createBackgroundSyncResult({
        payload: payload ?? null,
        matchedCurrentHead: true,
        refreshedRowIds: [],
        shouldRerenderBody: false,
        requiresChapterReload: handlingSummary.requiresChapterReload,
        requiresBlockingReload: true,
        performedBlockingReload,
        blockingReloadReason: handlingSummary.blockingReloadReason,
        handlingSummary,
      });
    }

    const safeRefreshRowIds = handlingSummary.safeRefreshRowIds;
    const markResult = markEditorRowsStale(payload);
    const dirtyRowResolution = await resolveBackgroundSyncDirtyRows(
      render,
      handlingSummary.deferredChangedRowIds.filter((rowId) =>
        rowCanAttemptDirtyBackgroundMerge(rowId, state.editorChapter),
      ),
    );
    const updatedHandlingSummary = updatedHandlingSummaryWithResolvedDeferredRows(
      handlingSummary,
      dirtyRowResolution.handledRowIds,
    );
    const refreshedRowIds = safeRefreshRowIds.length > 0
      ? await reloadBackgroundSyncSafeRows(render, safeRefreshRowIds)
      : [];
    const handledRowIds = [...refreshedRowIds, ...dirtyRowResolution.handledRowIds];
    const shouldRerenderBody = shouldRerenderBodyAfterSync(markResult, handledRowIds) || hadVisibleErrorBanner;
    setEditorBackgroundSyncState("idle", "");
    if (
      shouldRerenderBody
      && !(options.suppressConservativeRerender === true && updatedHandlingSummary.requiresChapterReload)
    ) {
      render?.({ scope: "translate-body" });
    }
    return createBackgroundSyncResult({
      payload: payload ?? null,
      matchedCurrentHead: true,
      refreshedRowIds,
      shouldRerenderBody,
      requiresChapterReload: updatedHandlingSummary.requiresChapterReload,
      requiresBlockingReload: false,
      performedBlockingReload: false,
      blockingReloadReason: null,
      handlingSummary: updatedHandlingSummary,
    });
  } catch (error) {
    if (sessionMatchesCurrentEditor()) {
      const message = error instanceof Error ? error.message : String(error);
      setEditorBackgroundSyncState("error", message);
      if (!hadVisibleErrorBanner || previousSyncError !== message) {
        render?.({ scope: "translate-body" });
      }
      const handled = await handleSyncFailure(classifySyncError(error), { render });
      if (!handled) {
        showNoticeBadge(message || "Background sync failed.", render, 2400);
      }
    }
    return createBackgroundSyncResult();
  }
}

export async function maybeStartEditorBackgroundSync(render, options = {}) {
  if (!sessionMatchesCurrentEditor()) {
    return false;
  }

  if (state.offline?.isEnabled === true) {
    return options.returnSummary === true ? createBackgroundSyncResult() : false;
  }

  if (editorBackgroundSyncSession.pendingSync) {
    const pendingResult = await editorBackgroundSyncSession.pendingSync;
    return options.returnSummary === true ? pendingResult : pendingResult.payload;
  }

  if (options.force !== true) {
    if (performance.now() - editorBackgroundSyncSession.lastScrollAt < EDITOR_SYNC_IDLE_MS) {
      return false;
    }
  }

  const syncPromise = runEditorBackgroundSync(render, options);
  editorBackgroundSyncSession.pendingSync = syncPromise;
  try {
    const result = await syncPromise;
    return options.returnSummary === true ? result : result.payload;
  } finally {
    editorBackgroundSyncSession.pendingSync = null;
  }
}

async function syncEditorBackgroundNowInternal(render, options = {}) {
  if (!sessionMatchesCurrentEditor()) {
    return createBackgroundSyncResult();
  }

  if (state.offline?.isEnabled === true) {
    return createBackgroundSyncResult();
  }

  if (options.afterLocalCommit === true) {
    while (editorBackgroundSyncSession.pendingSync) {
      await editorBackgroundSyncSession.pendingSync;
      if (!sessionMatchesCurrentEditor()) {
        return createBackgroundSyncResult();
      }
    }
  } else if (editorBackgroundSyncSession.pendingSync) {
    return editorBackgroundSyncSession.pendingSync;
  }

  if (editorBackgroundSyncSession.pendingSync) {
    return editorBackgroundSyncSession.pendingSync;
  }

  const syncPromise = runEditorBackgroundSync(render, {
    skipDirtyFlush: options.skipDirtyFlush === true,
    suppressConservativeRerender: options.suppressConservativeRerender === true,
  });
  editorBackgroundSyncSession.pendingSync = syncPromise;
  try {
    return await syncPromise;
  } finally {
    editorBackgroundSyncSession.pendingSync = null;
  }
}

export async function syncEditorBackgroundNow(render, options = {}) {
  const result = await syncEditorBackgroundNowInternal(render, options);
  return result.payload;
}

export async function syncEditorBackgroundNowWithSummary(render, options = {}) {
  return syncEditorBackgroundNowInternal(render, options);
}

export function noteEditorBackgroundSyncHead(headSha) {
  const normalizedHeadSha =
    typeof headSha === "string" && headSha.trim()
      ? headSha.trim()
      : "";
  if (!normalizedHeadSha || !sessionMatchesCurrentEditor()) {
    return;
  }

  editorBackgroundSyncSession.lastSyncedHeadSha = normalizedHeadSha;
}

export function noteEditorBackgroundSyncScrollActivity() {
  if (!sessionMatchesCurrentEditor()) {
    return;
  }

  editorBackgroundSyncSession.lastScrollAt = performance.now();
}

export function startEditorBackgroundSyncSession(render, options = {}) {
  if (state.offline?.isEnabled === true) {
    clearBackgroundSyncInterval();
    editorBackgroundSyncSession.key = "";
    editorBackgroundSyncSession.lastScrollAt = 0;
    editorBackgroundSyncSession.pendingSync = null;
    editorBackgroundSyncSession.lastSyncedHeadSha = null;
    return;
  }

  const key = currentSessionKey();
  const currentHeadSha =
    typeof state.editorChapter?.chapterBaseCommitSha === "string" && state.editorChapter.chapterBaseCommitSha.trim()
      ? state.editorChapter.chapterBaseCommitSha
      : null;
  if (
    options.forceRestart !== true
    && key
    && editorBackgroundSyncSession.key === key
    && Number.isInteger(editorBackgroundSyncSession.intervalId)
    && editorBackgroundSyncSession.intervalId !== 0
  ) {
    editorBackgroundSyncSession.lastSyncedHeadSha = currentHeadSha;
    return;
  }

  clearBackgroundSyncInterval();
  editorBackgroundSyncSession.key = key;
  editorBackgroundSyncSession.lastScrollAt = performance.now();
  editorBackgroundSyncSession.pendingSync = null;
  editorBackgroundSyncSession.lastSyncedHeadSha = currentHeadSha;

  if (!key) {
    return;
  }

  editorBackgroundSyncSession.intervalId = window.setInterval(() => {
    void maybeStartEditorBackgroundSync(render);
  }, EDITOR_SYNC_REMOTE_INTERVAL_MS);
  if (options.skipInitialSync !== true) {
    void maybeStartEditorBackgroundSync(render, { force: true });
  }
}

export async function syncAndStopEditorBackgroundSyncSession(render) {
  if (sessionMatchesCurrentEditor()) {
    await maybeStartEditorBackgroundSync(render, { force: true });
  }

  clearBackgroundSyncInterval();
  editorBackgroundSyncSession.key = "";
  editorBackgroundSyncSession.lastScrollAt = 0;
  editorBackgroundSyncSession.lastSyncedHeadSha = null;
  editorBackgroundSyncSession.pendingSync = null;
}
