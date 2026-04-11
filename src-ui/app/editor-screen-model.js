import { coerceEditorFontSizePx } from "./state.js";
import { editorChapterRows } from "./editor-row-model.js";
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

export function buildEditorScreenViewModel(appState) {
  const chapter = findChapterContextById(appState.selectedChapterId)?.chapter ?? null;
  const editorChapter =
    appState.editorChapter?.chapterId === appState.selectedChapterId ? appState.editorChapter : null;
  const languages = chapterLanguageOptions(chapter, editorChapter);
  const { sourceCode, targetCode } = resolveSelectedLanguageCodes(languages, chapter, editorChapter);
  const editorRows = editorChapterRows(editorChapter);
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
    editorRows,
    rowCount: editorRows.length,
    collapsedLanguageCodes,
    editorFontSizePx,
  };
}
