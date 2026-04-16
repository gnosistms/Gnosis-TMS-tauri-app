import { buildEditorRowSearchHighlights } from "./editor-search-highlighting.js";
import { normalizeEditorChapterFilterState } from "./editor-filters.js";
import { rowFieldsEqual } from "./editor-row-persistence-model.js";
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
import { buildEditorShowRowInContextChapterState } from "./editor-show-context.js";
import {
  buildVisibleEditorLanguageCodeSet,
  cloneRowFields,
  findEditorRowById,
} from "./editor-utils.js";
import { findChapterContextById, selectedProjectsTeam } from "./project-context.js";
import { invoke, waitForNextPaint } from "./runtime.js";
import { state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import {
  consumePrimedTranslateInteractionAnchor,
  consumePrimedTranslateMainScrollTop,
  captureTranslateRowAnchor,
  centerTranslateRowInView,
  queueTranslateRowAnchor,
  restoreTranslateRowAnchor,
} from "./scroll-state.js";

function normalizeEditorChapterFilters(filters) {
  return normalizeEditorChapterFilterState(filters);
}

function nextChapterBaseCommitSha(payload, chapterState = state.editorChapter) {
  return typeof payload?.chapterBaseCommitSha === "string" && payload.chapterBaseCommitSha.trim()
    ? payload.chapterBaseCommitSha.trim()
    : chapterState?.chapterBaseCommitSha ?? null;
}

function hasEditorSearchOperations(operations) {
  return (
    typeof operations?.markEditorRowsPersisted === "function"
    && typeof operations?.loadActiveEditorFieldHistory === "function"
  );
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

function buildEditorRowSections(row, chapterState = state.editorChapter) {
  return (Array.isArray(chapterState?.languages) ? chapterState.languages : []).map((language) => ({
    code: language.code,
    text: row?.fields?.[language.code] ?? "",
  }));
}

export function buildEditorRowSearchHighlightMap(row, chapterState = state.editorChapter) {
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

function scrollTranslateMainToTop() {
  const container = document.querySelector(".translate-main-scroll");
  if (!(container instanceof HTMLElement)) {
    return;
  }

  container.scrollTop = 0;
}

function renderEditorReplaceSelection(render) {
  render?.({ scope: "translate-header" });
  render?.({ scope: "translate-body" });
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

export function updateEditorRowFilterMode(render, nextValue) {
  if (!state.editorChapter?.chapterId) {
    return;
  }

  const currentFilters = normalizeEditorChapterFilters(state.editorChapter?.filters);
  const nextFilters = normalizeEditorChapterFilters({
    ...currentFilters,
    rowFilterMode: nextValue,
  });
  if (currentFilters.rowFilterMode === nextFilters.rowFilterMode) {
    return;
  }

  const searchIsActive = currentFilters.searchQuery.trim().length > 0;
  const currentReplaceState = normalizeEditorReplaceState(state.editorChapter?.replace);
  state.editorChapter = {
    ...state.editorChapter,
    filters: nextFilters,
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

export async function showEditorRowInContext(render, rowId) {
  if (!rowId || !state.editorChapter?.chapterId) {
    return;
  }

  queueTranslateRowAnchor({
    rowId,
    type: "row",
    offsetTop: 0,
  });
  state.editorChapter = buildEditorShowRowInContextChapterState(state.editorChapter);
  render?.();

  await waitForNextPaint();
  const centered = centerTranslateRowInView(rowId);
  if (!centered) {
    await waitForNextPaint();
    centerTranslateRowInView(rowId);
    return;
  }

  await waitForNextPaint();
  centerTranslateRowInView(rowId);
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

  const scrollAnchor =
    consumePrimedTranslateInteractionAnchor(rowId)
    ?? captureTranslateRowAnchor(anchorTarget);
  const scrollTop = consumePrimedTranslateMainScrollTop();

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
  render?.({ scope: "translate-header" });
  const restoreSelectionViewport = () => {
    if (Number.isFinite(scrollTop)) {
      const container = document.querySelector(".translate-main-scroll");
      if (container instanceof HTMLElement) {
        container.scrollTop = scrollTop;
      }
    }

    if (scrollAnchor) {
      restoreTranslateRowAnchor(scrollAnchor);
    }
  };
  restoreSelectionViewport();
  void waitForNextPaint().then(() => {
    restoreSelectionViewport();
    void waitForNextPaint().then(() => {
      restoreSelectionViewport();
    });
  });
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
  renderEditorReplaceSelection(render);
}

export async function replaceSelectedEditorRows(render, operations = {}) {
  if (!hasEditorSearchOperations(operations)) {
    return;
  }

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
  if (state.editorChapter.deferredStructuralChanges === true) {
    showNoticeBadge("Refresh the file before running replace.", render);
    return;
  }
  if (selectedRows.some((row) => row.freshness === "stale" || row.freshness === "staleDirty" || row.freshness === "conflict" || row.remotelyDeleted === true)) {
    showNoticeBadge("Refresh or resolve the selected rows before running replace.", render);
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
        operations.markEditorRowsPersisted(
          resetRows,
          resetPayload?.sourceWordCounts,
          nextChapterBaseCommitSha(resetPayload, state.editorChapter),
        );
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
      operations.markEditorRowsPersisted(
        replacePlan.updatedRows,
        payload?.sourceWordCounts,
        nextChapterBaseCommitSha(payload, state.editorChapter),
      );
      updateEditorReplaceState(state, (currentState) => ({
        ...currentState,
        status: "idle",
        error: "",
        selectedRowIds: new Set(),
      }));
      render?.();
      if (affectedRowIds.has(state.editorChapter.activeRowId)) {
        operations.loadActiveEditorFieldHistory(render);
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
