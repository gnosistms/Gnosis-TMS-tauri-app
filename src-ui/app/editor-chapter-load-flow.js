import { loadActiveEditorRowComments, loadEditorCommentSeenRevisionsForChapter } from "./editor-comments-flow.js";
import {
  applyStoredSelectedTeamAiActionPreferences,
  ensureSharedAiActionConfigurationLoaded,
} from "./ai-settings-flow.js";
import { loadStoredEditorAssistantChapterData } from "./editor-ai-assistant-cache.js";
import { loadStoredEditorDerivedGlossariesForChapter, saveStoredEditorDerivedGlossariesForChapter } from "./editor-derived-glossary-cache.js";
import { hydrateEditorDerivedGlossariesByRowId } from "./editor-derived-glossary-state.js";
import {
  editorGlossaryStateMatchesLink,
  loadEditorGlossaryState,
  normalizeEditorGlossaryLink,
} from "./editor-glossary-flow.js";
import {
  EDITOR_ROW_FILTER_MODE_HAS_CONFLICT,
  normalizeEditorChapterFilterState,
} from "./editor-filters.js";
import { normalizeLanguageSelections } from "./editor-selection-flow.js";
import { hasActiveEditorField } from "./editor-utils.js";
import {
  captureEditorWritePermissionSnapshot,
  createEditorWriteLockState,
} from "./editor-write-permission.js";
import {
  ensureProjectNotTombstoned,
} from "./project-chapter-flow.js";
import { findChapterContextById, selectedProjectsTeam } from "./project-context.js";
import {
  clearRestoredLocalHardDeleteTombstones,
  filterLocalHardDeletedResources,
} from "./local-hard-delete-store.js";
import { invoke } from "./runtime.js";
import {
  anyEditorOperationIsActive,
  waitForEditorOperationQueueIdle,
} from "./editor-operation-queue.js";
import { resetProjectsPageSync } from "./page-sync.js";
import { cloneDirtyRowIds } from "./editor-row-persistence-model.js";
import {
  createEditorChapterFilterState,
  createEditorChapterGlossaryState,
  createEditorCommentsState,
  createEditorHistoryState,
  createEditorMainFieldEditorState,
  createEditorPendingSelectionState,
  createTargetLanguageManagerState,
  state,
} from "./state.js";
import { clearNoticeBadge, clearScopedSyncBadge, showNoticeBadge, showScopedSyncBadge } from "./status-feedback.js";
import { canManageProjects } from "./resource-capabilities.js";
import { findIsoLanguageOption, normalizeSupportedLanguageCode } from "../lib/language-options.js";
import { projectRepoScope } from "./repo-write-queue.js";

function normalizeEditorChapterFilters(filters) {
  return normalizeEditorChapterFilterState(filters);
}

function initialEditorChapterFiltersForContext(chapter) {
  const filters = createEditorChapterFilterState();
  if (chapter?.hasImportedEditorConflicts === true) {
    return {
      ...filters,
      rowFilterMode: EDITOR_ROW_FILTER_MODE_HAS_CONFLICT,
    };
  }
  return filters;
}

function editorAiActionConfigRender(render) {
  return (options = {}) => {
    if (!render) {
      return;
    }

    if (
      options?.scope === "translate-body"
      || options?.scope === "translate-header"
      || options?.scope === "translate-sidebar"
    ) {
      render(options);
      return;
    }

    render({ scope: "translate-sidebar" });
  };
}

function hasEditorChapterReloadOperations(operations) {
  return (
    typeof operations?.applyEditorUiState === "function"
    && typeof operations?.normalizeEditorRows === "function"
    && typeof operations?.applyChapterMetadataToState === "function"
    && typeof operations?.loadActiveEditorFieldHistory === "function"
  );
}

function hasEditorChapterLoadOperations(operations) {
  return (
    hasEditorChapterReloadOperations(operations)
    && typeof operations?.flushDirtyEditorRows === "function"
    && typeof operations?.persistEditorChapterSelections === "function"
  );
}

// During an async chapter reload the user may keep typing (rows stay live and
// interactive while the payload is in flight). Those edits land on the live
// state.editorChapter, but the reload rebuilds rows wholesale from the payload
// and derives dirty tracking from the pre-invoke snapshot — silently dropping
// both the typed content and its unsaved-change indicator. Preserve the live
// dirty rows' content and ids for the chapter being reloaded.
export function mergeInFlightDirtyEditorRows(reloadedRows, liveChapter, chapterId) {
  const empty = { rows: reloadedRows, dirtyRowIds: new Set() };
  if (!chapterId || liveChapter?.chapterId !== chapterId) {
    return empty;
  }
  const liveDirtyRowIds = cloneDirtyRowIds(liveChapter.dirtyRowIds);
  if (liveDirtyRowIds.size === 0) {
    return empty;
  }
  const liveRowsById = new Map(
    (Array.isArray(liveChapter.rows) ? liveChapter.rows : [])
      .filter((row) => row?.rowId)
      .map((row) => [row.rowId, row]),
  );
  const rows = reloadedRows.map((row) =>
    row?.rowId && liveDirtyRowIds.has(row.rowId) && liveRowsById.has(row.rowId)
      ? liveRowsById.get(row.rowId)
      : row,
  );
  const presentRowIds = new Set(rows.map((row) => row?.rowId).filter(Boolean));
  const dirtyRowIds = new Set(
    [...liveDirtyRowIds].filter((rowId) => presentRowIds.has(rowId)),
  );
  return { rows, dirtyRowIds };
}

function applyEditorPayloadToState(
  payload,
  projectId,
  existingChapter = {},
  glossaryState = null,
  derivedGlossariesByRowId = {},
  operations = {},
  previousEditorChapter = state.editorChapter,
) {
  if (!hasEditorChapterReloadOperations(operations)) {
    return;
  }

  const { selectedSourceLanguageCode, selectedTargetLanguageCode } = normalizeLanguageSelections(
    payload.languages,
    existingChapter.selectedSourceLanguageCode ?? payload.selectedSourceLanguageCode,
    existingChapter.selectedTargetLanguageCode ?? payload.selectedTargetLanguageCode,
  );
  const normalizedRows = operations.normalizeEditorRows(payload.rows);
  const team = selectedProjectsTeam();
  clearRestoredLocalHardDeleteTombstones(team, "editorRow", normalizedRows, {
    isActive: (row) => row?.lifecycleState !== "deleted",
  });
  const visibleRows = filterLocalHardDeletedResources(team, "editorRow", normalizedRows, {
    isDeleted: (row) => row?.lifecycleState === "deleted",
  });
  // Same-chapter reload (manual refresh / "Try again"): keep any edits the user
  // typed while the payload was in flight. Fresh loads of a different chapter
  // must not carry a prior chapter's dirty rows, so gate on chapter identity.
  const isSameChapterReload = previousEditorChapter?.chapterId === payload.chapterId;
  const { rows: reconciledRows, dirtyRowIds: preservedDirtyRowIds } = isSameChapterReload
    ? mergeInFlightDirtyEditorRows(visibleRows, state.editorChapter, payload.chapterId)
    : { rows: visibleRows, dirtyRowIds: new Set() };
  const hasImportedEditorConflicts = visibleRows.some((row) =>
    row?.freshness === "conflict"
    || row?.saveStatus === "conflict"
    || Boolean(row?.conflictState),
  );

  state.editorChapter = operations.applyEditorUiState({
    status: "ready",
    error: "",
    projectId,
    chapterId: payload.chapterId,
    chapterBaseCommitSha: payload.chapterBaseCommitSha ?? null,
    fileTitle: payload.fileTitle,
    languages: Array.isArray(payload.languages) ? payload.languages : [],
    wordCounts:
      payload.wordCounts && typeof payload.wordCounts === "object"
        ? payload.wordCounts
        : {},
    selectedSourceLanguageCode,
    selectedTargetLanguageCode,
    persistedSourceLanguageCode: selectedSourceLanguageCode,
    persistedTargetLanguageCode: selectedTargetLanguageCode,
    selectionPersistStatus: "idle",
    filters: initialEditorChapterFiltersForContext(existingChapter),
    assistant: previousEditorChapter?.assistant,
    commentSeenRevisions: loadEditorCommentSeenRevisionsForChapter(
      payload.chapterId,
      visibleRows.map((row) => row?.rowId).filter(Boolean),
    ),
    glossary: glossaryState ?? previousEditorChapter?.glossary ?? createEditorChapterGlossaryState(),
    derivedGlossariesByRowId,
    deferredStructuralChanges: false,
    backgroundSyncStatus: "idle",
    backgroundSyncError: "",
    rows: reconciledRows,
  }, previousEditorChapter);

  if (preservedDirtyRowIds.size > 0) {
    // applyEditorUiState derived dirtyRowIds from the pre-invoke snapshot; union
    // in the rows that only became dirty while the reload was in flight.
    state.editorChapter = {
      ...state.editorChapter,
      dirtyRowIds: new Set([
        ...cloneDirtyRowIds(state.editorChapter.dirtyRowIds),
        ...preservedDirtyRowIds,
      ]),
    };
  }

  operations.applyChapterMetadataToState(payload.chapterId, {
    name: payload.fileTitle,
    languages: state.editorChapter.languages,
    wordCounts: state.editorChapter.wordCounts,
    selectedSourceLanguageCode,
    selectedTargetLanguageCode,
    hasImportedEditorConflicts,
  });
}

function managedChapterLanguagesFromPayload(languages) {
  return (Array.isArray(languages) ? languages : [])
    .map((language) => {
      const code = normalizeSupportedLanguageCode(language?.code) || String(language?.code ?? "").trim();
      if (!code) {
        return null;
      }
      const option = findIsoLanguageOption(code);
      return {
        code,
        name: String(language?.name ?? "").trim() || option?.name || code,
        role: String(language?.role ?? "").trim().toLowerCase() === "source" ? "source" : "target",
      };
    })
    .filter(Boolean);
}

function openLanguageManagerForSingleLanguageFile(payload, preserveVisibleRows, team) {
  const languages = managedChapterLanguagesFromPayload(payload?.languages);
  if (
    preserveVisibleRows
    || languages.length !== 1
    || !canManageProjects(team)
    || state.targetLanguageManager?.isOpen
  ) {
    return;
  }

  state.targetLanguageManager = {
    ...createTargetLanguageManagerState(),
    isOpen: true,
    chapterId: state.editorChapter?.chapterId ?? payload?.chapterId ?? null,
    languages,
  };
}

function editorOperationBelongsToChapter(operation, repoScope, chapterId) {
  if (!repoScope || !chapterId) {
    return false;
  }
  return (
    operation?.repoScope === repoScope
    && operation?.metadata?.chapterId === chapterId
  );
}

async function waitForPendingEditorWritesBeforeChapterOpen(render, team, context) {
  const repoScope = projectRepoScope({ team, project: context?.project ?? null });
  const chapterId = context?.chapter?.id ?? "";
  const matchesOpeningChapter = (operation) =>
    editorOperationBelongsToChapter(operation, repoScope, chapterId);

  if (!anyEditorOperationIsActive(matchesOpeningChapter)) {
    return;
  }

  if (state.screen === "projects") {
    showScopedSyncBadge("projects", "Finishing pending editor saves...", render);
  }
  await waitForEditorOperationQueueIdle(matchesOpeningChapter);
  if (state.screen === "projects") {
    clearScopedSyncBadge("projects", render);
  }
}

function hasPendingEditorWritesForChapter(team, context) {
  const repoScope = projectRepoScope({ team, project: context?.project ?? null });
  const chapterId = context?.chapter?.id ?? "";
  return anyEditorOperationIsActive((operation) =>
    editorOperationBelongsToChapter(operation, repoScope, chapterId)
  );
}

function canResumeCurrentEditorChapter(chapterId) {
  return (
    state.editorChapter?.chapterId === chapterId
    && Array.isArray(state.editorChapter.rows)
    && state.editorChapter.rows.length > 0
  );
}

export async function loadSelectedChapterEditorData(render, options = {}, operations = {}) {
  if (!hasEditorChapterReloadOperations(operations)) {
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
  const aiActionConfigRender = editorAiActionConfigRender(render);
  applyStoredSelectedTeamAiActionPreferences(aiActionConfigRender);
  if (state.offline?.isEnabled !== true) {
    void ensureSharedAiActionConfigurationLoaded(aiActionConfigRender).catch(() => {});
  }
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
  const storedAssistantChapterData = loadStoredEditorAssistantChapterData(
    team,
    context.project.id,
    context.chapter.id,
  );
  const previousEditorChapter = state.editorChapter;

  state.selectedProjectId = context.project.id;
  state.editorChapter = {
    ...state.editorChapter,
    status: preserveVisibleRows ? "refreshing" : "loading",
    error: "",
    projectId: context.project.id,
    chapterId: context.chapter.id,
    chapterBaseCommitSha: preserveVisibleRows ? state.editorChapter.chapterBaseCommitSha : null,
    fileTitle: context.chapter.name ?? "",
    languages: preserveVisibleRows
      ? state.editorChapter.languages
      : Array.isArray(context.chapter.languages) ? context.chapter.languages : [],
    wordCounts:
      preserveVisibleRows
        ? state.editorChapter.wordCounts
        : context.chapter.wordCounts && typeof context.chapter.wordCounts === "object"
          ? context.chapter.wordCounts
          : {},
    selectedSourceLanguageCode: nextSelectedSourceLanguageCode,
    selectedTargetLanguageCode: nextSelectedTargetLanguageCode,
    persistedSourceLanguageCode: nextSelectedSourceLanguageCode,
    persistedTargetLanguageCode: nextSelectedTargetLanguageCode,
    selectionPersistStatus: "idle",
    writePermissionSnapshot: preserveVisibleRows
      ? state.editorChapter.writePermissionSnapshot
      : captureEditorWritePermissionSnapshot({
        team,
        project: context.project,
        chapter: context.chapter,
      }),
    writeLock: preserveVisibleRows
      ? state.editorChapter.writeLock
      : createEditorWriteLockState(),
    filters: preserveVisibleRows
      ? normalizeEditorChapterFilters(state.editorChapter.filters)
      : initialEditorChapterFiltersForContext(context.chapter),
    glossary: nextGlossaryState,
    derivedGlossariesByRowId: preserveVisibleRows
      ? state.editorChapter.derivedGlossariesByRowId
      : {},
    activeRowId: preserveVisibleRows ? state.editorChapter.activeRowId : null,
    activeLanguageCode: preserveVisibleRows ? state.editorChapter.activeLanguageCode : null,
    mainFieldEditor: preserveVisibleRows
      ? state.editorChapter.mainFieldEditor
      : createEditorMainFieldEditorState(),
    pendingSelection: preserveVisibleRows
      ? state.editorChapter.pendingSelection
      : createEditorPendingSelectionState(),
    sidebarTab: preserveVisibleRows ? state.editorChapter.sidebarTab : "review",
    assistant: preserveVisibleRows ? state.editorChapter.assistant : storedAssistantChapterData,
    commentSeenRevisions: preserveVisibleRows ? state.editorChapter.commentSeenRevisions : {},
    comments: preserveVisibleRows ? state.editorChapter.comments : createEditorCommentsState(),
    history: preserveVisibleRows ? state.editorChapter.history : createEditorHistoryState(),
    deferredStructuralChanges: preserveVisibleRows ? state.editorChapter.deferredStructuralChanges : false,
    backgroundSyncStatus: preserveVisibleRows ? state.editorChapter.backgroundSyncStatus : "idle",
    backgroundSyncError: preserveVisibleRows ? state.editorChapter.backgroundSyncError : "",
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
    const validRowIds = new Set(
      (Array.isArray(payload?.rows) ? payload.rows : [])
        .map((row) => row?.rowId)
        .filter(Boolean),
    );
    const storedDerivedGlossariesByRowId = loadStoredEditorDerivedGlossariesForChapter(
      team,
      context.project.id,
      context.chapter.id,
    );
    const filteredStoredDerivedGlossariesByRowId = Object.fromEntries(
      Object.entries(storedDerivedGlossariesByRowId)
        .filter(([rowId]) => validRowIds.has(rowId)),
    );
    if (
      Object.keys(filteredStoredDerivedGlossariesByRowId).length
      !== Object.keys(storedDerivedGlossariesByRowId).length
    ) {
      saveStoredEditorDerivedGlossariesForChapter(
        team,
        context.project.id,
        context.chapter.id,
        filteredStoredDerivedGlossariesByRowId,
      );
    }
    const hydratedDerivedGlossariesByRowId = hydrateEditorDerivedGlossariesByRowId(
      filteredStoredDerivedGlossariesByRowId,
      payload?.languages,
      glossaryState,
    );
    applyEditorPayloadToState(
      payload,
      context.project.id,
      context.chapter,
      glossaryState,
      hydratedDerivedGlossariesByRowId,
      operations,
      previousEditorChapter,
    );
    openLanguageManagerForSingleLanguageFile(payload, preserveVisibleRows, team);
    render?.();
    if (state.editorChapter.sidebarTab === "comments" && state.editorChapter.activeRowId) {
      loadActiveEditorRowComments(render);
    } else if (state.editorChapter.sidebarTab === "assistant") {
      return;
    } else if (hasActiveEditorField(state.editorChapter)) {
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
      mainFieldEditor: createEditorMainFieldEditorState(),
      pendingSelection: createEditorPendingSelectionState(),
      comments: createEditorCommentsState(),
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

  if (!(await operations.flushDirtyEditorRows(render, { waitForDurable: false }))) {
    showNoticeBadge("Could not queue pending saves before opening a different file.", render);
    return;
  }

  const team = selectedProjectsTeam();
  const resumeCurrentChapter =
    canResumeCurrentEditorChapter(chapterId)
    && hasPendingEditorWritesForChapter(team, context);
  if (!resumeCurrentChapter) {
    await waitForPendingEditorWritesBeforeChapterOpen(render, team, context);
  }

  void operations.persistEditorChapterSelections(render);
  if (state.screen === "projects") {
    resetProjectsPageSync();
    clearNoticeBadge();
    clearScopedSyncBadge("projects", render);
  }
  state.selectedProjectId = context.project.id;
  state.selectedChapterId = chapterId;
  state.screen = "translate";
  if (resumeCurrentChapter) {
    state.editorChapter = {
      ...state.editorChapter,
      status: "ready",
      error: "",
      projectId: context.project.id,
      chapterId,
    };
    render?.();
    return;
  }
  await loadSelectedChapterEditorData(render, {}, operations);
}
