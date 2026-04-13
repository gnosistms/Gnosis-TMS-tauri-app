import { buildEditorCommentsButtonState, normalizeEditorSidebarTab } from "./editor-comments.js";
import { coerceEditorFontSizePx } from "./state.js";
import { canPermanentlyDeleteProjectFiles } from "./resource-capabilities.js";
import { findChapterContextById, selectedProjectsTeam } from "./project-context.js";
import { buildEditorFilterResult } from "./editor-filters.js";
import { normalizeEditorReplaceState } from "./editor-replace.js";

let cachedEditorRowsRef = null;
let cachedEditorLanguagesRef = null;
let cachedLiveTranslationRows = [];

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
    cachedLiveTranslationRows = [];
    return [];
  }

  if (editorRows === cachedEditorRowsRef && languageOptions === cachedEditorLanguagesRef) {
    return cachedLiveTranslationRows;
  }

  const liveRows = editorRows.map((row) => {
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
      hasConflict: row?.freshness === "conflict",
      isStale: row?.freshness === "stale" || row?.freshness === "staleDirty",
      conflictState: row?.conflictState ?? null,
      sections: languageOptions.map((language) => ({
        code: language.code,
        name: language.name,
        text: row.fields?.[language.code] ?? "",
        reviewed: row.fieldStates?.[language.code]?.reviewed === true,
        pleaseCheck: row.fieldStates?.[language.code]?.pleaseCheck === true,
        markerSaveState:
          row.markerSaveState?.languageCode === language.code
            ? row.markerSaveState
            : { status: "idle", languageCode: null, kind: null, error: "" },
      })),
    };
  });

  cachedEditorRowsRef = editorRows;
  cachedEditorLanguagesRef = languageOptions;
  cachedLiveTranslationRows = liveRows;
  return liveRows;
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
      sections: (Array.isArray(row.sections) ? row.sections : []).map((section) => ({
        ...section,
        ...buildEditorCommentsButtonState({
          row,
          languageCode: section.code,
          targetLanguageCode: targetCode,
          seenRevisions: commentSeenRevisions,
        }),
        isSelectedCommentsRow:
          normalizeEditorSidebarTab(editorChapter?.sidebarTab) === "comments"
          && editorChapter?.activeRowId === row.rowId
          && editorChapter?.activeLanguageCode === section.code,
      })),
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
