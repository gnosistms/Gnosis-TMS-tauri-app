import { buildEditorRowSearchHighlights } from "./editor-search-highlighting.js";
import {
  editorChapterFiltersAreActive,
  normalizeEditorChapterFilterState,
} from "./editor-filters.js";
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
  editorLanguageFootnoteIsVisible,
  editorLanguageFootnoteText,
  findEditorRowById,
} from "./editor-utils.js";
import { findChapterContextById, selectedProjectsTeam } from "./project-context.js";
import { waitForNextPaint } from "./runtime.js";
import { noteUserScrollIntent, readSessionAnchor } from "./editor-scroll-session.js";
import { state } from "./state.js";
import { showNoticeBadge } from "./status-feedback.js";
import {
  assertCurrentEditorWritePermission,
  handleEditorPermissionDenied,
} from "./editor-write-permission.js";
import { requestEditorOperation } from "./editor-operation-queue.js";
import {
  assertQueuedEditorRowsReady,
  createQueuedEditorWritePermissionContext,
  editorChapterInvalidationKey,
  invokeQueuedEditorWriteCommand,
} from "./editor-queued-write.js";
import { projectRepoScope } from "./repo-write-queue.js";
import {
  captureVisibleTranslateLocation,
  captureTranslateRowAnchor,
  centerTranslateRowInView,
  findTranslateAnchorElement,
  queueTranslateRowAnchor,
  readTranslateMainScrollTop,
  restoreTranslateRowAnchor,
} from "./scroll-state.js";

let editorFilterRestoreChapterId = null;
let editorFilterRestoreViewport = null;

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

function buildEditorRowSections(row, chapterState = state.editorChapter) {
  const sections = [];
  for (const language of Array.isArray(chapterState?.languages) ? chapterState.languages : []) {
    sections.push({
      code: language.code,
      text: row?.fields?.[language.code] ?? "",
      contentKind: "field",
    });
    if (editorLanguageFootnoteIsVisible(row, language.code, chapterState)) {
      sections.push({
        code: language.code,
        text: editorLanguageFootnoteText(row, language.code),
        contentKind: "footnote",
      });
    }
    const imageCaption = row?.imageCaptions?.[language.code] ?? "";
    if (String(imageCaption).trim().length > 0) {
      sections.push({
        code: language.code,
        text: imageCaption,
        contentKind: "image-caption",
      });
    }
  }

  return sections;
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

  // Deliberate jump: anchors captured before it must go stale.
  noteUserScrollIntent("filter-scroll-top");
  container.scrollTop = 0;
}

function currentEditorChapterId() {
  return typeof state.editorChapter?.chapterId === "string" && state.editorChapter.chapterId.trim()
    ? state.editorChapter.chapterId.trim()
    : null;
}

function captureEditorFilterRestoreViewport(chapterId) {
  if (!chapterId) {
    return;
  }

  editorFilterRestoreChapterId = chapterId;
  // Prefer the continuously tracked session anchor (scroll redesign P4); the
  // DOM scan remains as fallback before the session's first update.
  editorFilterRestoreViewport = {
    anchor: readSessionAnchor(chapterId) ?? captureVisibleTranslateLocation(),
    scrollTop: readTranslateMainScrollTop(),
  };
}

function clearEditorFilterRestoreViewport(chapterId = null) {
  if (chapterId && editorFilterRestoreChapterId !== chapterId) {
    return;
  }

  editorFilterRestoreChapterId = null;
  editorFilterRestoreViewport = null;
}

function consumeEditorFilterRestoreViewport(chapterId) {
  if (!chapterId || editorFilterRestoreChapterId !== chapterId) {
    return null;
  }

  const viewport = editorFilterRestoreViewport;
  clearEditorFilterRestoreViewport(chapterId);
  return viewport;
}

function prepareEditorFilterViewportTransition(previousFilters, nextFilters) {
  const chapterId = currentEditorChapterId();
  const wasActive = editorChapterFiltersAreActive(previousFilters);
  const isActive = editorChapterFiltersAreActive(nextFilters);

  if (!wasActive && isActive) {
    captureEditorFilterRestoreViewport(chapterId);
    return {
      restoreViewport: null,
      scrollToTop: true,
    };
  }

  if (wasActive && !isActive) {
    return {
      restoreViewport: consumeEditorFilterRestoreViewport(chapterId),
      scrollToTop: false,
    };
  }

  return {
    restoreViewport: null,
    scrollToTop: isActive,
  };
}

function restoreEditorFilterViewport(restoreViewport) {
  // Deliberate jump: restoring the pre-filter viewport is the direct
  // response to the user clearing the filter, so anchors captured before it
  // must go stale rather than dragging the viewport back.
  noteUserScrollIntent("filter-restore");
  const applyRestore = () => {
    const container = document.querySelector(".translate-main-scroll");
    if (!(container instanceof HTMLElement)) {
      return;
    }

    // Anchor-first; the raw offset only positions the window until the
    // anchor row mounts, then the paint retries align it exactly.
    const anchor = restoreViewport.anchor?.rowId ? restoreViewport.anchor : null;
    if (anchor && findTranslateAnchorElement(anchor)) {
      restoreTranslateRowAnchor(anchor);
      return;
    }

    if (Number.isFinite(restoreViewport.scrollTop)) {
      container.scrollTop = restoreViewport.scrollTop;
    }
  };
  applyRestore();
  void waitForNextPaint().then(() => {
    applyRestore();
    void waitForNextPaint().then(applyRestore);
  });
}

function renderEditorFilterChange(render, viewportTransition) {
  render?.();
  if (viewportTransition?.restoreViewport) {
    restoreEditorFilterViewport(viewportTransition.restoreViewport);
    return;
  }

  if (viewportTransition?.scrollToTop) {
    void waitForNextPaint().then(() => {
      scrollTranslateMainToTop();
    });
  }
}

function renderEditorReplaceSelection(render) {
  render?.({ scope: "translate-header" });
  render?.({ scope: "translate-body" });
}

export function updateEditorSearchFilterQuery(render, nextValue) {
  const currentFilters = normalizeEditorChapterFilters(state.editorChapter?.filters);
  const previousSearchQuery = currentFilters.searchQuery;
  const nextSearchQuery = typeof nextValue === "string" ? nextValue : String(nextValue ?? "");
  const searchChanged = previousSearchQuery !== nextSearchQuery;
  const searchIsActive = nextSearchQuery.trim().length > 0;
  const nextFilters = {
    ...currentFilters,
    searchQuery: nextSearchQuery,
  };
  const viewportTransition = prepareEditorFilterViewportTransition(currentFilters, nextFilters);
  const currentReplaceState = normalizeEditorReplaceState(state.editorChapter?.replace);
  state.editorChapter = {
    ...state.editorChapter,
    filters: nextFilters,
    replace: {
      ...currentReplaceState,
      enabled: searchIsActive ? currentReplaceState.enabled : false,
      selectedRowIds: searchChanged ? new Set() : cloneEditorReplaceSelectedRowIds(currentReplaceState.selectedRowIds),
      status: "idle",
      error: "",
    },
  };
  renderEditorFilterChange(render, viewportTransition);
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

  const nextFilters = {
    ...currentFilters,
    caseSensitive: nextCaseSensitive,
  };
  const viewportTransition = prepareEditorFilterViewportTransition(currentFilters, nextFilters);
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
  renderEditorFilterChange(render, viewportTransition);
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

  const viewportTransition = prepareEditorFilterViewportTransition(currentFilters, nextFilters);
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
  renderEditorFilterChange(render, viewportTransition);
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
  clearEditorFilterRestoreViewport(state.editorChapter.chapterId);
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

export function toggleEditorReplaceRowSelected(render, rowId, selected) {
  if (!rowId || !state.editorChapter?.chapterId) {
    return;
  }

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
  // Only the toolbar selection count re-renders; the checkbox itself toggles
  // natively and the scroll container is untouched.
  render?.({ scope: "translate-header" });
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
    .filter((row) =>
      !rowFieldsEqual(row.fields, row.persistedFields)
      || !rowFieldsEqual(row.footnotes, row.persistedFootnotes)
      || !rowFieldsEqual(row.imageCaptions, row.persistedImageCaptions)
    )
    .map((row) => ({
      rowId: row.rowId,
      fields: cloneRowFields(row.fields),
      footnotes: cloneRowFields(row.footnotes),
      imageCaptions: cloneRowFields(row.imageCaptions),
    }));

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
      showNoticeBadge(error?.message ?? String(error), render);
    }
    return;
  }

  updateEditorReplaceState(state, (currentState) => ({
    ...currentState,
    status: "saving",
    error: "",
  }));
  render?.();

  const operationValue = {
    chapterId: editorChapter.chapterId,
    resetRows,
    replaceRows: replacePlan.updatedRows,
    updatedRowIds: replacePlan.updatedRowIds,
    searchQuery,
    replaceCount: replacePlan.updatedRows.length,
    inputBase: {
      installationId: team.installationId,
      projectId: context.project.id,
      repoName: context.project.name,
      chapterId: editorChapter.chapterId,
    },
    permissionContext: createQueuedEditorWritePermissionContext({
      team,
      project: context.project,
      chapter: context.chapter,
      actionKind: "sharedWrite",
    }),
  };

  const requested = requestEditorOperation({
    repoScope,
    chapterScope: `${repoScope}:${editorChapter.chapterId}`,
    kind: "replaceSelected",
    value: operationValue,
    metadata: {
      projectId: context.project.id,
      chapterId: editorChapter.chapterId,
      rowIds: replacePlan.updatedRowIds,
    },
    invalidationKeys: [editorChapterInvalidationKey(repoScope, editorChapter.chapterId)],
  }, {
    run: async (operation) => {
      const value = operation.value;
      assertQueuedEditorRowsReady({
        chapterId: value.chapterId,
        rowIds: value.updatedRowIds,
        forbidPendingText: true,
        message: "Refresh, save, or resolve the selected rows before running replace.",
      });
      let resetPayload = null;
      if (value.resetRows.length > 0) {
        resetPayload = await invokeQueuedEditorWriteCommand("update_gtms_editor_row_fields_batch", {
          input: {
            ...value.inputBase,
            rows: value.resetRows,
            commitMessage: buildEditorReplaceResetCommitMessage(value.resetRows.length),
            operation: "editor-replace-reset",
          },
        }, value.permissionContext, render);
      }

      const replacePayload = await invokeQueuedEditorWriteCommand("update_gtms_editor_row_fields_batch", {
        input: {
          ...value.inputBase,
          rows: value.replaceRows,
          commitMessage: buildEditorReplaceCommitMessage(value.searchQuery, value.replaceRows.length),
          operation: "editor-replace",
        },
      }, value.permissionContext, render);
      return { resetPayload, replacePayload };
    },
    onSuccess: ({ resetPayload, replacePayload } = {}, operation) => {
      const value = operation?.value ?? operationValue;
      if (state.editorChapter?.chapterId !== value.chapterId) {
        return;
      }
      if (value.resetRows.length > 0) {
        operations.markEditorRowsPersisted(
          value.resetRows,
          resetPayload?.wordCounts,
          nextChapterBaseCommitSha(resetPayload, state.editorChapter),
        );
      }
      operations.markEditorRowsPersisted(
        value.replaceRows,
        replacePayload?.wordCounts,
        nextChapterBaseCommitSha(replacePayload, state.editorChapter),
      );
      updateEditorReplaceState(state, (currentState) => ({
        ...currentState,
        status: "idle",
        error: "",
        selectedRowIds: new Set(),
      }));
      render?.();
      if (new Set(value.updatedRowIds).has(state.editorChapter.activeRowId)) {
        operations.loadActiveEditorFieldHistory(render);
      }
      showNoticeBadge(`Replaced text in ${formatReplaceRowCount(value.replaceCount)}.`, render);
    },
    onError: (error, operation) => {
      const value = operation?.value ?? operationValue;
      const message = error instanceof Error ? error.message : String(error);
      if (state.editorChapter?.chapterId === value.chapterId) {
        updateEditorReplaceState(state, (currentState) => ({
          ...currentState,
          status: "idle",
          error: message,
        }));
        render?.();
      }
      showNoticeBadge(message || "The selected rows could not be replaced.", render);
    },
  });
  requested.promise.catch(() => {});
}
