import { buildEditorCommentsButtonState, normalizeEditorSidebarTab } from "./editor-comments.js";
import {
  conflictedLanguageCodesForRow,
  rowHasUnresolvedEditorConflict,
} from "./editor-conflicts.js";
import { normalizeEditorAiTranslateState } from "./editor-ai-translate-state.js";
import { normalizeEditorDerivedGlossariesByRowId } from "./editor-derived-glossary-state.js";
import { coerceEditorFontSizePx } from "./state.js";
import { canPermanentlyDeleteProjectFiles } from "./resource-capabilities.js";
import { findChapterContextById, selectedProjectsTeam } from "./project-context.js";
import { buildEditorFilterResult, editorChapterFiltersAreActive } from "./editor-filters.js";
import { normalizeEditorReplaceState } from "./editor-replace.js";
import {
  editorImageEditorMatches,
  editorImageCaptionEditorMatches,
  editorFootnoteEditorMatches,
  editorLanguageImage,
  editorLanguageImageCaptionText,
  editorLanguageFootnoteIsVisible,
  editorLanguageFootnoteText,
} from "./editor-utils.js";

let cachedEditorRowsRef = null;
let cachedEditorLanguagesRef = null;
let cachedActiveRowId = null;
let cachedActiveLanguageCode = null;
let cachedFootnoteEditorRowId = null;
let cachedFootnoteEditorLanguageCode = null;
let cachedImageCaptionEditorRowId = null;
let cachedImageCaptionEditorLanguageCode = null;
let cachedImageEditorRowId = null;
let cachedImageEditorLanguageCode = null;
let cachedImageEditorMode = null;
let cachedImageEditorInvalidUrl = false;
let cachedLiveTranslationRows = [];
const AI_TRANSLATE_PREPARING_TEXT = "Preparing glossary...";
const AI_TRANSLATE_LOADING_TEXT = "Translating...";

function createEditorAiTranslateLoadingKey(rowId, languageCode) {
  return `${rowId}:${languageCode}`;
}

function chapterLanguageOptions(chapter, editorChapter) {
  if (Array.isArray(editorChapter?.languages) && editorChapter.languages.length > 0) {
    return editorChapter.languages;
  }

  if (Array.isArray(chapter?.languages) && chapter.languages.length > 0) {
    return chapter.languages;
  }

  return [];
}

function resolveSelectedLanguageCodes(languages, chapter, editorChapter) {
  const roleBasedSourceCode = languages.find((language) => language.role === "source")?.code ?? null;
  const sourceCode =
    editorChapter?.selectedSourceLanguageCode
    ?? chapter?.selectedSourceLanguageCode
    ?? roleBasedSourceCode
    ?? languages[0]?.code
    ?? null;
  const targetCode =
    editorChapter?.selectedTargetLanguageCode
    ?? chapter?.selectedTargetLanguageCode
    ?? languages.find((language) => language.code !== sourceCode && language.role === "target")?.code
    ?? languages.find((language) => language.code !== sourceCode)?.code
    ?? sourceCode;

  return { sourceCode, targetCode };
}

function buildLiveTranslationRows(editorChapter, languages) {
  const editorRows = Array.isArray(editorChapter?.rows) ? editorChapter.rows : null;
  const languageOptions = Array.isArray(languages) ? languages : [];

  if (!editorRows || editorRows.length === 0) {
    cachedEditorRowsRef = editorRows;
    cachedEditorLanguagesRef = languageOptions;
    cachedActiveRowId = editorChapter?.activeRowId ?? null;
    cachedActiveLanguageCode = editorChapter?.activeLanguageCode ?? null;
    cachedFootnoteEditorRowId = editorChapter?.footnoteEditor?.rowId ?? null;
    cachedFootnoteEditorLanguageCode = editorChapter?.footnoteEditor?.languageCode ?? null;
    cachedImageCaptionEditorRowId = editorChapter?.imageCaptionEditor?.rowId ?? null;
    cachedImageCaptionEditorLanguageCode = editorChapter?.imageCaptionEditor?.languageCode ?? null;
    cachedImageEditorRowId = editorChapter?.imageEditor?.rowId ?? null;
    cachedImageEditorLanguageCode = editorChapter?.imageEditor?.languageCode ?? null;
    cachedImageEditorMode = editorChapter?.imageEditor?.mode ?? null;
    cachedImageEditorInvalidUrl = editorChapter?.imageEditor?.invalidUrl === true;
    cachedLiveTranslationRows = [];
    return [];
  }

  if (
    editorRows === cachedEditorRowsRef
    && languageOptions === cachedEditorLanguagesRef
    && (editorChapter?.activeRowId ?? null) === cachedActiveRowId
    && (editorChapter?.activeLanguageCode ?? null) === cachedActiveLanguageCode
    && (editorChapter?.footnoteEditor?.rowId ?? null) === cachedFootnoteEditorRowId
    && (editorChapter?.footnoteEditor?.languageCode ?? null) === cachedFootnoteEditorLanguageCode
    && (editorChapter?.imageCaptionEditor?.rowId ?? null) === cachedImageCaptionEditorRowId
    && (editorChapter?.imageCaptionEditor?.languageCode ?? null) === cachedImageCaptionEditorLanguageCode
    && (editorChapter?.imageEditor?.rowId ?? null) === cachedImageEditorRowId
    && (editorChapter?.imageEditor?.languageCode ?? null) === cachedImageEditorLanguageCode
    && (editorChapter?.imageEditor?.mode ?? null) === cachedImageEditorMode
    && (editorChapter?.imageEditor?.invalidUrl === true) === cachedImageEditorInvalidUrl
  ) {
    return cachedLiveTranslationRows;
  }

  const liveRows = editorRows.map((row) => {
    const hasConflict = rowHasUnresolvedEditorConflict(row);
    const conflictLanguageCodes = hasConflict
      ? conflictedLanguageCodesForRow(row, languageOptions)
      : new Set();
    return {
      ...row,
      kind: "row",
      id: row.rowId,
      rowId: row.rowId,
      lifecycleState: row.lifecycleState === "deleted" ? "deleted" : "active",
      orderKey: row.orderKey || "",
      commentCount: Number.isInteger(row?.commentCount) && row.commentCount >= 0 ? row.commentCount : 0,
      commentsRevision:
        Number.isInteger(row?.commentsRevision) && row.commentsRevision >= 0 ? row.commentsRevision : 0,
      saveStatus: row.saveStatus || "idle",
      saveError: row.saveError || "",
      freshness: typeof row?.freshness === "string" ? row.freshness : "fresh",
      remotelyDeleted: row?.remotelyDeleted === true,
      hasConflict,
      isStale: row?.freshness === "stale" || row?.freshness === "staleDirty",
      conflictState: row?.conflictState ?? null,
      conflictLanguageCodes: [...conflictLanguageCodes],
      sections: languageOptions.map((language) => {
        const image = editorLanguageImage(row, language.code);
        const isImageUrlEditorOpen = editorImageEditorMatches(
          editorChapter,
          row.rowId,
          language.code,
          "url",
        ) && editorChapter?.imageEditor?.status !== "submitting";
        const isImageUploadEditorOpen = editorImageEditorMatches(
          editorChapter,
          row.rowId,
          language.code,
          "upload",
        );
        const isImageUrlSubmitting =
          editorImageEditorMatches(editorChapter, row.rowId, language.code, "url")
          && editorChapter?.imageEditor?.status === "submitting";
        const showInvalidImageUrl =
          editorImageEditorMatches(editorChapter, row.rowId, language.code)
          && editorChapter?.imageEditor?.invalidUrl === true;
        const hasSavedImage = Boolean(image);
        const imageCaption = editorLanguageImageCaptionText(row, language.code);
        const isImageCaptionEditorOpen =
          hasSavedImage && editorImageCaptionEditorMatches(editorChapter, row.rowId, language.code);
        return {
          code: language.code,
          name: language.name,
          text: row.fields?.[language.code] ?? "",
          footnote: editorLanguageFootnoteText(row, language.code),
          imageCaption,
          image,
          hasVisibleFootnote: editorLanguageFootnoteIsVisible(row, language.code, editorChapter),
          hasVisibleImage:
            hasSavedImage
            || isImageUrlEditorOpen
            || isImageUploadEditorOpen
            || showInvalidImageUrl,
          hasVisibleImageCaption:
            hasSavedImage
            && (
              isImageCaptionEditorOpen
              || imageCaption.trim().length > 0
            ),
          isFootnoteEditorOpen: editorFootnoteEditorMatches(editorChapter, row.rowId, language.code),
          isImageCaptionEditorOpen,
          isImageUrlEditorOpen,
          isImageUploadEditorOpen,
          showInvalidImageUrl,
          imageUrlDraft:
            isImageUrlEditorOpen || showInvalidImageUrl
              ? String(editorChapter?.imageEditor?.urlDraft ?? "")
              : "",
          showAddFootnoteButton:
            editorLanguageFootnoteText(row, language.code).trim().length === 0
            && !editorFootnoteEditorMatches(editorChapter, row.rowId, language.code),
          showAddImageButtons:
            !hasSavedImage
            && !isImageUrlEditorOpen
            && !isImageUploadEditorOpen
            && !isImageUrlSubmitting,
          showAddImageCaptionButton:
            hasSavedImage
            && imageCaption.trim().length === 0
            && !isImageCaptionEditorOpen,
          isActive:
            editorChapter?.activeRowId === row.rowId
            && editorChapter?.activeLanguageCode === language.code,
          reviewed: row.fieldStates?.[language.code]?.reviewed === true,
          pleaseCheck: row.fieldStates?.[language.code]?.pleaseCheck === true,
          hasConflict: conflictLanguageCodes.has(language.code),
          conflictDisabled: hasConflict && !conflictLanguageCodes.has(language.code),
          markerSaveState:
            row.markerSaveState?.languageCode === language.code
              ? row.markerSaveState
              : { status: "idle", languageCode: null, kind: null, error: "" },
        };
      }),
    };
  });

  cachedEditorRowsRef = editorRows;
  cachedEditorLanguagesRef = languageOptions;
  cachedActiveRowId = editorChapter?.activeRowId ?? null;
  cachedActiveLanguageCode = editorChapter?.activeLanguageCode ?? null;
  cachedFootnoteEditorRowId = editorChapter?.footnoteEditor?.rowId ?? null;
  cachedFootnoteEditorLanguageCode = editorChapter?.footnoteEditor?.languageCode ?? null;
  cachedImageCaptionEditorRowId = editorChapter?.imageCaptionEditor?.rowId ?? null;
  cachedImageCaptionEditorLanguageCode = editorChapter?.imageCaptionEditor?.languageCode ?? null;
  cachedImageEditorRowId = editorChapter?.imageEditor?.rowId ?? null;
  cachedImageEditorLanguageCode = editorChapter?.imageEditor?.languageCode ?? null;
  cachedImageEditorMode = editorChapter?.imageEditor?.mode ?? null;
  cachedImageEditorInvalidUrl = editorChapter?.imageEditor?.invalidUrl === true;
  cachedLiveTranslationRows = liveRows;
  return liveRows;
}

function resolveActiveEditorAiTranslateLoadingTexts(editorChapter, rows, sourceCode) {
  const loadingTexts = new Map();
  if (!sourceCode) {
    return loadingTexts;
  }

  const rowById = new Map(
    (Array.isArray(rows) ? rows : [])
      .filter((row) => row?.rowId)
      .map((row) => [row.rowId, row]),
  );
  const derivedGlossariesByRowId = normalizeEditorDerivedGlossariesByRowId(
    editorChapter?.derivedGlossariesByRowId,
  );
  for (const actionState of Object.values(normalizeEditorAiTranslateState(editorChapter?.aiTranslate))) {
    if (
      actionState.status !== "loading"
      || !actionState.rowId
      || !actionState.targetLanguageCode
      || actionState.sourceLanguageCode !== sourceCode
    ) {
      continue;
    }

    const row = rowById.get(actionState.rowId);
    if (!row) {
      continue;
    }

    const currentSourceText =
      typeof row?.fields?.[sourceCode] === "string"
        ? row.fields[sourceCode]
        : String(row?.fields?.[sourceCode] ?? "");
    if (actionState.sourceText !== currentSourceText) {
      continue;
    }

    const derivedEntry = derivedGlossariesByRowId[actionState.rowId];
    const loadingText =
      derivedEntry?.status === "loading" && derivedEntry.requestKey === actionState.requestKey
        ? AI_TRANSLATE_PREPARING_TEXT
        : AI_TRANSLATE_LOADING_TEXT;
    loadingTexts.set(
      createEditorAiTranslateLoadingKey(actionState.rowId, actionState.targetLanguageCode),
      loadingText,
    );
  }

  return loadingTexts;
}

function buildEditorReplaceViewModel(editorChapter, editorFilters) {
  const replaceState = normalizeEditorReplaceState(editorChapter?.replace);
  const isAvailable = (editorFilters?.filters?.searchQuery ?? "").trim().length > 0;
  const isEnabled = isAvailable && replaceState.enabled;
  const matchingRowIds = new Set(
    (Array.isArray(editorFilters?.filteredRows) ? editorFilters.filteredRows : [])
      .filter((row) => row?.lifecycleState !== "deleted")
      .map((row) => row.id)
      .filter(Boolean),
  );
  const selectedMatchingRowIds = isEnabled
    ? [...replaceState.selectedRowIds].filter((rowId) => matchingRowIds.has(rowId))
    : [];

  return {
    ...replaceState,
    isAvailable,
    isEnabled,
    matchingRowIds,
    matchingRowCount: matchingRowIds.size,
    selectedMatchingRowIds,
    selectedMatchingRowCount: selectedMatchingRowIds.length,
  };
}

function buildEditorDisplayItems(contentRows, editorChapter, team, editorReplace) {
  const rows = Array.isArray(contentRows) ? contentRows : [];
  const showContextAction = editorChapterFiltersAreActive(editorChapter?.filters);
  const expandedDeletedRowGroupIds =
    editorChapter?.expandedDeletedRowGroupIds instanceof Set
      ? editorChapter.expandedDeletedRowGroupIds
      : new Set();
  const canEditRows = team?.canManageProjects === true;
  const canRestoreRows = Number.isFinite(team?.installationId);
  const canPermanentlyDeleteRows = canPermanentlyDeleteProjectFiles(team);
  const selectedReplaceRowIds =
    editorReplace?.selectedMatchingRowIds instanceof Array
      ? new Set(editorReplace.selectedMatchingRowIds)
      : new Set();
  const items = [];
  let deletedRun = [];

  const flushDeletedRun = () => {
    if (deletedRun.length === 0) {
      return;
    }

    const groupId = deletedRun.map((row) => row.rowId).join(":");
    const isOpen = expandedDeletedRowGroupIds.has(groupId);
    items.push({
      kind: "deleted-group",
      id: `deleted-group:${groupId}`,
      groupId,
      label: "Deleted rows",
      isOpen,
      rowCount: deletedRun.length,
    });
    if (isOpen) {
      items.push(...deletedRun);
    }
    deletedRun = [];
  };

  for (const row of rows) {
    const nextRow = {
      ...row,
      canInsert: row.lifecycleState === "active" && canEditRows,
      canSoftDelete: row.lifecycleState === "active" && canEditRows,
      canRestore: row.lifecycleState === "deleted" && canRestoreRows,
      canPermanentDelete: row.lifecycleState === "deleted" && canPermanentlyDeleteRows,
      showContextAction: row.lifecycleState === "active" && showContextAction,
      canReplaceSelect: row.lifecycleState === "active" && editorReplace?.isEnabled === true,
      replaceSelected: selectedReplaceRowIds.has(row.id),
      replaceSelectionDisabled: editorReplace?.status === "saving",
    };
    if (nextRow.lifecycleState === "deleted") {
      deletedRun.push(nextRow);
      continue;
    }

    flushDeletedRun();
    items.push(nextRow);
  }

  flushDeletedRun();
  return items;
}

export function buildEditorScreenViewModel(appState) {
  const chapter = findChapterContextById(appState.selectedChapterId)?.chapter ?? null;
  const editorChapter =
    appState.editorChapter?.chapterId === appState.selectedChapterId ? appState.editorChapter : null;
  const languages = chapterLanguageOptions(chapter, editorChapter);
  const { sourceCode, targetCode } = resolveSelectedLanguageCodes(languages, chapter, editorChapter);
  const rawRows = buildLiveTranslationRows(editorChapter, languages);
  const activeAiTranslateLoadingTexts = resolveActiveEditorAiTranslateLoadingTexts(
    editorChapter,
    rawRows,
    sourceCode,
  );
  const collapsedLanguageCodes =
    editorChapter?.collapsedLanguageCodes instanceof Set
      ? editorChapter.collapsedLanguageCodes
      : new Set();
  const commentSeenRevisions =
    editorChapter?.commentSeenRevisions && typeof editorChapter.commentSeenRevisions === "object"
      ? editorChapter.commentSeenRevisions
      : {};
  const editorFilters = buildEditorFilterResult({
    rows: rawRows,
    languages,
    collapsedLanguageCodes,
    filters: editorChapter?.filters,
    targetLanguageCode: targetCode,
    commentSeenRevisions,
  });
  const editorReplace = buildEditorReplaceViewModel(editorChapter, editorFilters);
  const contentRows = buildEditorDisplayItems(
    editorFilters.filteredRows,
    editorChapter,
    selectedProjectsTeam(),
    editorReplace,
  ).map((row) => {
    if (row?.kind !== "row") {
      return row;
    }

    return {
      ...row,
      sections: (Array.isArray(row.sections) ? row.sections : []).map((section) => {
        const aiTranslateLoadingText = activeAiTranslateLoadingTexts.get(
          createEditorAiTranslateLoadingKey(row.rowId, section.code),
        );
        const isAiTranslating = typeof aiTranslateLoadingText === "string";
        return {
          ...section,
          text:
            isAiTranslating
              ? aiTranslateLoadingText
              : section.text,
          ...buildEditorCommentsButtonState({
            row,
            languageCode: section.code,
            targetLanguageCode: targetCode,
            seenRevisions: commentSeenRevisions,
          }),
          isAiTranslating,
          isSelectedCommentsRow:
            normalizeEditorSidebarTab(editorChapter?.sidebarTab) === "comments"
            && editorChapter?.activeRowId === row.rowId
            && editorChapter?.activeLanguageCode === section.code,
        };
      }),
    };
  });
  const editorFontSizePx = coerceEditorFontSizePx(editorChapter?.fontSizePx);

  return {
    chapter,
    editorChapter,
    languages,
    sourceCode,
    targetCode,
    contentRows,
    editorFilters,
    editorReplace,
    collapsedLanguageCodes,
    editorFontSizePx,
    sidebarTab: normalizeEditorSidebarTab(editorChapter?.sidebarTab),
  };
}
