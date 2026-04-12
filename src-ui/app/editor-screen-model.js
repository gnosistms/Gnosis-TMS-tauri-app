import { coerceEditorFontSizePx } from "./state.js";
import { canPermanentlyDeleteProjectFiles } from "./resource-capabilities.js";
import { selectedProjectsTeam } from "./project-chapter-flow.js";
import { findChapterContextById } from "./translate-flow.js";

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

  const liveRows = editorRows.map((row, index) => {
    return {
      kind: "row",
      id: row.rowId,
      rowId: row.rowId,
      lifecycleState: row.lifecycleState === "deleted" ? "deleted" : "active",
      orderKey: row.orderKey || "",
      saveStatus: row.saveStatus || "idle",
      saveError: row.saveError || "",
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

function buildEditorDisplayItems(contentRows, editorChapter, team) {
  const rows = Array.isArray(contentRows) ? contentRows : [];
  const expandedDeletedRowGroupIds =
    editorChapter?.expandedDeletedRowGroupIds instanceof Set
      ? editorChapter.expandedDeletedRowGroupIds
      : new Set();
  const canEditRows = team?.canManageProjects === true;
  const canRestoreRows = Number.isFinite(team?.installationId);
  const canPermanentlyDeleteRows = canPermanentlyDeleteProjectFiles(team);
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
  const contentRows = buildEditorDisplayItems(rawRows, editorChapter, selectedProjectsTeam());
  const collapsedLanguageCodes =
    editorChapter?.collapsedLanguageCodes instanceof Set
      ? editorChapter.collapsedLanguageCodes
      : new Set();
  const editorFontSizePx = coerceEditorFontSizePx(editorChapter?.fontSizePx);

  return {
    chapter,
    editorChapter,
    languages,
    sourceCode,
    targetCode,
    contentRows,
    collapsedLanguageCodes,
    editorFontSizePx,
  };
}
