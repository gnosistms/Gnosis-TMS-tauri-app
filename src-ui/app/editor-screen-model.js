import { coerceEditorFontSizePx } from "./state.js";
import { findChapterContextById } from "./translate-flow.js";

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
  const sourceCode =
    editorChapter?.selectedSourceLanguageCode
    ?? chapter?.selectedSourceLanguageCode
    ?? languages[0]?.code
    ?? languages.find((language) => language.role === "source")?.code
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
  if (!Array.isArray(editorChapter?.rows) || editorChapter.rows.length === 0) {
    return [];
  }

  return editorChapter.rows.map((row, index) => {
    const label =
      row.externalId?.trim()
      || row.description?.trim()
      || row.context?.trim()
      || `Row ${index + 1}`;

    return {
      id: row.rowId,
      title: label,
      saveStatus: row.saveStatus || "idle",
      saveError: row.saveError || "",
      sections: languages.map((language) => ({
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
}

export function buildEditorScreenViewModel(appState) {
  const chapter = findChapterContextById(appState.selectedChapterId)?.chapter ?? null;
  const editorChapter =
    appState.editorChapter?.chapterId === appState.selectedChapterId ? appState.editorChapter : null;
  const languages = chapterLanguageOptions(chapter, editorChapter);
  const { sourceCode, targetCode } = resolveSelectedLanguageCodes(languages, chapter, editorChapter);
  const contentRows = buildLiveTranslationRows(editorChapter, languages);
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
