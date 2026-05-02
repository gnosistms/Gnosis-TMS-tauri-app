import { saveStoredProjectsForTeam } from "./project-cache.js";
import { currentEditorAiReviewForSelection } from "./editor-ai-review-state.js";
import {
  buildEditorAssistantThreadKey,
  normalizeEditorAssistantState,
} from "./editor-ai-assistant-state.js";
import { normalizeEditorAiTranslateState } from "./editor-ai-translate-state.js";
import { normalizeEditorSidebarTab } from "./editor-comments.js";
import { pruneEditorCommentSeenRevisionsForRows } from "./editor-comments-state.js";
import { currentEditorHistoryForSelection } from "./editor-history-state.js";
import { compactDirtyRowIds, reconcileDirtyTrackedEditorRows } from "./editor-dirty-row-state.js";
import { normalizeEditorDerivedGlossariesByRowId } from "./editor-derived-glossary-state.js";
import { normalizeEditorChapterFilterState } from "./editor-filters.js";
import {
  EDITOR_MODE_TRANSLATE,
  normalizeEditorMode,
  normalizeEditorPreviewSearchState,
} from "./editor-preview.js";
import { normalizeEditorReplaceState } from "./editor-replace.js";
import { normalizeEditorRowTextStyle } from "./editor-row-text-style.js";
import {
  cloneRowFields,
  cloneRowFieldStates,
  cloneRowImages,
  editorMainFieldEditorMatches,
  hasEditorLanguage,
  hasEditorRow,
} from "./editor-utils.js";
import { selectedProjectsTeam } from "./project-context.js";
import {
  coerceEditorFontSizePx,
  createEditorChapterFilterState,
  createEditorChapterGlossaryState,
  createEditorClearTranslationsModalState,
  createEditorMainFieldEditorState,
  createEditorCommentsState,
  createEditorConflictResolutionModalState,
  createEditorAiReviewState,
  createEditorAssistantState,
  createEditorAiTranslateActionState,
  createEditorAiTranslateState,
  createEditorFootnoteEditorState,
  createEditorImageCaptionEditorState,
  createEditorImageEditorState,
  createEditorImageInvalidFileModalState,
  createEditorImagePreviewOverlayState,
  createEditorPendingSelectionState,
  createEditorPreviewSearchState,
  createEditorReplaceUndoModalState,
  createEditorReplaceState,
  createEditorHistoryState,
  createEditorInsertRowModalState,
  createEditorUnreviewAllModalState,
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

function cloneExpandedReviewSectionKeys(expandedSectionKeys) {
  return expandedSectionKeys instanceof Set
    ? new Set(expandedSectionKeys)
    : new Set(["last-update", "ai-review"]);
}

function preserveEditorMode(previousEditorChapter, isSameChapter) {
  if (!isSameChapter) {
    return EDITOR_MODE_TRANSLATE;
  }

  return normalizeEditorMode(previousEditorChapter?.mode);
}

function preserveEditorPreviewSearch(previousEditorChapter, isSameChapter) {
  if (!isSameChapter) {
    return createEditorPreviewSearchState();
  }

  return normalizeEditorPreviewSearchState(previousEditorChapter?.previewSearch);
}

function normalizeImportedConflictRemoteRow(row) {
  if (!row || typeof row !== "object") {
    return null;
  }

  return normalizeEditorRow({
    ...row,
    importedConflict: null,
  });
}

function normalizeImportedConflictPayload(importedConflict) {
  if (!importedConflict || typeof importedConflict !== "object") {
    return null;
  }

  return {
    conflictKind:
      typeof importedConflict.conflictKind === "string" && importedConflict.conflictKind.trim()
        ? importedConflict.conflictKind.trim()
        : "imported-git-conflict",
    remoteRow: normalizeImportedConflictRemoteRow(importedConflict.remoteRow),
    baseRow: normalizeImportedConflictRemoteRow(importedConflict.baseRow),
  };
}

function preserveEditorAiTranslateState(nextEditorChapter, previousEditorChapter, isSameChapter) {
  if (!isSameChapter) {
    return createEditorAiTranslateState();
  }

  const previousAiTranslate = normalizeEditorAiTranslateState(previousEditorChapter?.aiTranslate);
  const nextAiTranslate = createEditorAiTranslateState();

  for (const [actionId, actionState] of Object.entries(previousAiTranslate)) {
    if (
      hasEditorRow(nextEditorChapter, actionState.rowId)
      && hasEditorLanguage(nextEditorChapter, actionState.sourceLanguageCode)
      && hasEditorLanguage(nextEditorChapter, actionState.targetLanguageCode)
    ) {
      nextAiTranslate[actionId] = actionState;
    } else {
      nextAiTranslate[actionId] = createEditorAiTranslateActionState();
    }
  }

  return nextAiTranslate;
}

function preserveEditorAssistantState(nextEditorChapter, previousEditorChapter, isSameChapter) {
  if (!isSameChapter) {
    return createEditorAssistantState();
  }

  const previousAssistant = normalizeEditorAssistantState(previousEditorChapter?.assistant);
  const nextAssistant = createEditorAssistantState();

  nextAssistant.composerDraft = previousAssistant.composerDraft;
  nextAssistant.activeThreadKey = previousAssistant.activeThreadKey;
  nextAssistant.threadsByKey = Object.fromEntries(
    Object.entries(previousAssistant.threadsByKey).filter(([, thread]) =>
      hasEditorRow(nextEditorChapter, thread.rowId)
      && hasEditorLanguage(nextEditorChapter, thread.targetLanguageCode),
    ),
  );
  nextAssistant.chapterArtifacts = previousAssistant.chapterArtifacts;

  if (!(nextAssistant.activeThreadKey in nextAssistant.threadsByKey)) {
    nextAssistant.activeThreadKey = null;
  }

  return nextAssistant;
}

function preserveEditorDerivedGlossariesByRowId(
  nextEditorChapter,
  previousEditorChapter,
  isSameChapter,
) {
  const hasNextDerivedGlossaries =
    Boolean(nextEditorChapter)
    && Object.prototype.hasOwnProperty.call(nextEditorChapter, "derivedGlossariesByRowId");
  const previousDerivedGlossariesByRowId = normalizeEditorDerivedGlossariesByRowId(
    previousEditorChapter?.derivedGlossariesByRowId,
  );
  const nextDerivedGlossariesByRowId = normalizeEditorDerivedGlossariesByRowId(
    nextEditorChapter?.derivedGlossariesByRowId,
  );
  const sourceEntries = !isSameChapter
    ? nextDerivedGlossariesByRowId
    : hasNextDerivedGlossaries
      ? nextDerivedGlossariesByRowId
      : previousDerivedGlossariesByRowId;

  return Object.fromEntries(
    Object.entries(sourceEntries).filter(([rowId, entry]) =>
      hasEditorRow(nextEditorChapter, rowId)
      && hasEditorLanguage(nextEditorChapter, entry.translationSourceLanguageCode)
      && hasEditorLanguage(nextEditorChapter, entry.glossarySourceLanguageCode)
      && hasEditorLanguage(nextEditorChapter, entry.targetLanguageCode)
    ),
  );
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
  const aiReview = currentEditorAiReviewForSelection(
    previousEditorChapter,
    activeRowId,
    activeLanguageCode,
  );
  const sidebarTab =
    typeof previousEditorChapter?.sidebarTab === "string"
      ? previousEditorChapter.sidebarTab
      : "review";

  return pruneEditorCommentSeenRevisionsForRows({
    ...nextEditorChapter,
    mode: preserveEditorMode(previousEditorChapter, isSameChapter),
    previewSearch: preserveEditorPreviewSearch(previousEditorChapter, isSameChapter),
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
    derivedGlossariesByRowId: preserveEditorDerivedGlossariesByRowId(
      nextEditorChapter,
      previousEditorChapter,
      isSameChapter,
    ),
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
    unreviewAllModal:
      isSameChapter
        && previousEditorChapter?.unreviewAllModal?.isOpen === true
        && hasEditorLanguage(nextEditorChapter, previousEditorChapter.unreviewAllModal.languageCode)
        ? {
          ...createEditorUnreviewAllModalState(),
          ...previousEditorChapter.unreviewAllModal,
        }
        : createEditorUnreviewAllModalState(),
    clearTranslationsModal:
      isSameChapter
        && previousEditorChapter?.clearTranslationsModal?.isOpen === true
        ? {
          ...createEditorClearTranslationsModalState(),
          ...previousEditorChapter.clearTranslationsModal,
          selectedLanguageCodes: (Array.isArray(previousEditorChapter.clearTranslationsModal.selectedLanguageCodes)
            ? previousEditorChapter.clearTranslationsModal.selectedLanguageCodes
            : []
          ).filter((languageCode) => hasEditorLanguage(nextEditorChapter, languageCode)),
        }
        : createEditorClearTranslationsModalState(),
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
    mainFieldEditor:
      isSameChapter
      && editorMainFieldEditorMatches(
        previousEditorChapter,
        previousEditorChapter?.mainFieldEditor?.rowId ?? null,
        previousEditorChapter?.mainFieldEditor?.languageCode ?? null,
      )
      && hasEditorRow(nextEditorChapter, previousEditorChapter?.mainFieldEditor?.rowId)
      && hasEditorLanguage(nextEditorChapter, previousEditorChapter?.mainFieldEditor?.languageCode)
        ? {
          rowId: previousEditorChapter.mainFieldEditor.rowId,
          languageCode: previousEditorChapter.mainFieldEditor.languageCode,
        }
        : createEditorMainFieldEditorState(),
    pendingSelection: createEditorPendingSelectionState(),
    footnoteEditor: createEditorFootnoteEditorState(),
    imageCaptionEditor: createEditorImageCaptionEditorState(),
    imageEditor: createEditorImageEditorState(),
    imageInvalidFileModal: createEditorImageInvalidFileModalState(),
    imagePreviewOverlay: createEditorImagePreviewOverlayState(),
    sidebarTab: normalizeEditorSidebarTab(sidebarTab),
    reviewExpandedSectionKeys: isSameChapter
      ? cloneExpandedReviewSectionKeys(previousEditorChapter?.reviewExpandedSectionKeys)
      : new Set(["last-update", "ai-review"]),
    aiReview:
      hasEditorRow(nextEditorChapter, activeRowId) && hasEditorLanguage(nextEditorChapter, activeLanguageCode)
        ? aiReview
        : createEditorAiReviewState(),
    aiTranslate: preserveEditorAiTranslateState(
      nextEditorChapter,
      previousEditorChapter,
      isSameChapter,
    ),
    assistant: preserveEditorAssistantState(
      nextEditorChapter,
      previousEditorChapter,
      isSameChapter,
    ),
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
  const importedConflict = normalizeImportedConflictPayload(row?.importedConflict);
  const fields = cloneRowFields(row?.fields);
  const footnotes = cloneRowFields(row?.footnotes);
  const imageCaptions = cloneRowFields(row?.imageCaptions);
  const images = cloneRowImages(row?.images);
  const fieldStates = cloneRowFieldStates(row?.fieldStates);
  const textStyle = normalizeEditorRowTextStyle(row?.textStyle);
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
    textStyle,
    fields,
    footnotes,
    imageCaptions,
    images,
    baseFields: cloneRowFields(fields),
    baseFootnotes: cloneRowFields(footnotes),
    baseImageCaptions: cloneRowFields(imageCaptions),
    baseImages: cloneRowImages(images),
    persistedFields: cloneRowFields(fields),
    persistedFootnotes: cloneRowFields(footnotes),
    persistedImageCaptions: cloneRowFields(imageCaptions),
    persistedImages: cloneRowImages(images),
    fieldStates,
    persistedFieldStates: cloneRowFieldStates(fieldStates),
    freshness: importedConflict ? "conflict" : "fresh",
    remotelyDeleted: false,
    conflictState: importedConflict
      ? {
        baseFields: cloneRowFields(importedConflict.baseRow?.fields),
        baseFootnotes: cloneRowFields(importedConflict.baseRow?.footnotes),
        baseImageCaptions: cloneRowFields(importedConflict.baseRow?.imageCaptions),
        remoteRow: importedConflict.remoteRow,
        remoteVersion: null,
      }
      : null,
    saveStatus: importedConflict ? "conflict" : "idle",
    saveError: importedConflict ? "Translation text changed on GitHub." : "",
    importedConflictKind: importedConflict?.conflictKind ?? null,
    markerSaveState: {
      status: "idle",
      languageCode: null,
      kind: null,
      error: "",
    },
    textStyleSaveState: {
      status: "idle",
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

export function removeEditorChapterRow(rowId) {
  if (!state.editorChapter?.chapterId || !Array.isArray(state.editorChapter.rows)) {
    return;
  }

  const rows = state.editorChapter.rows.filter((row) => row?.rowId !== rowId);
  const aiTranslate = normalizeEditorAiTranslateState(state.editorChapter.aiTranslate);
  const assistant = normalizeEditorAssistantState(state.editorChapter.assistant);
  const derivedGlossariesByRowId = normalizeEditorDerivedGlossariesByRowId(
    state.editorChapter.derivedGlossariesByRowId,
  );
  delete derivedGlossariesByRowId[rowId];
  const assistantThreadsByKey = Object.fromEntries(
    Object.entries(assistant.threadsByKey).filter(([, thread]) => thread.rowId !== rowId),
  );
  state.editorChapter = {
    ...state.editorChapter,
    rows,
    derivedGlossariesByRowId,
    dirtyRowIds: compactDirtyRowIds(rows, state.editorChapter.dirtyRowIds),
    activeRowId: state.editorChapter.activeRowId === rowId ? null : state.editorChapter.activeRowId,
    activeLanguageCode: state.editorChapter.activeRowId === rowId ? null : state.editorChapter.activeLanguageCode,
    mainFieldEditor:
      state.editorChapter.mainFieldEditor?.rowId === rowId
        ? createEditorMainFieldEditorState()
        : state.editorChapter.mainFieldEditor,
    pendingSelection:
      state.editorChapter.pendingSelection?.rowId === rowId
        ? createEditorPendingSelectionState()
        : state.editorChapter.pendingSelection,
    comments: state.editorChapter.activeRowId === rowId ? createEditorCommentsState() : state.editorChapter.comments,
    history: state.editorChapter.activeRowId === rowId ? createEditorHistoryState() : state.editorChapter.history,
    assistant: {
      ...assistant,
      activeThreadKey:
        assistant.activeThreadKey
        && buildEditorAssistantThreadKey(rowId, state.editorChapter.selectedTargetLanguageCode) === assistant.activeThreadKey
          ? null
          : assistant.activeThreadKey,
      threadsByKey: assistantThreadsByKey,
    },
    aiTranslate: Object.fromEntries(
      Object.entries(aiTranslate).map(([actionId, actionState]) => [
        actionId,
        actionState.rowId === rowId ? createEditorAiTranslateActionState() : actionState,
      ]),
    ),
  };
}

export function markEditorRowsPersisted(rowUpdates, sourceWordCounts = null, chapterBaseCommitSha = null) {
  const updatesByRowId = new Map(
    (Array.isArray(rowUpdates) ? rowUpdates : []).map((row) => [
      row.rowId,
      {
        fields: cloneRowFields(row.fields),
        footnotes: cloneRowFields(row.footnotes),
        imageCaptions:
          row && typeof row === "object" && "imageCaptions" in row
            ? cloneRowFields(row.imageCaptions)
            : null,
        images:
          row && typeof row === "object" && "images" in row
            ? cloneRowImages(row.images)
            : null,
      },
    ]),
  );
  if (updatesByRowId.size === 0 || !state.editorChapter?.chapterId) {
    return;
  }

  state.editorChapter = {
    ...state.editorChapter,
    chapterBaseCommitSha:
      typeof chapterBaseCommitSha === "string" && chapterBaseCommitSha.trim()
        ? chapterBaseCommitSha.trim()
        : state.editorChapter.chapterBaseCommitSha,
    rows: state.editorChapter.rows.map((row) => {
      if (!updatesByRowId.has(row.rowId)) {
        return row;
      }

      const update = updatesByRowId.get(row.rowId);
      const fields = update?.fields ?? cloneRowFields(row.fields);
      const footnotes = update?.footnotes ?? cloneRowFields(row.footnotes);
      const imageCaptions = update?.imageCaptions ?? cloneRowFields(row.imageCaptions);
      const images = update?.images ?? cloneRowImages(row.images);
      return {
        ...row,
        fields,
        footnotes,
        imageCaptions,
        images,
        persistedFields: cloneRowFields(fields),
        persistedFootnotes: cloneRowFields(footnotes),
        persistedImageCaptions: cloneRowFields(imageCaptions),
        persistedImages: cloneRowImages(images),
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
