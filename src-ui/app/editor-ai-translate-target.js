import { normalizeLanguageSelections } from "./editor-selection-flow.js";

export function resolveEditorAiTranslateLanguages(chapterState) {
  const languages = Array.isArray(chapterState?.languages) ? chapterState.languages : [];
  if (languages.length === 0) {
    return {
      languages: [],
      sourceLanguageCode: null,
      toolbarTargetLanguageCode: null,
      targetLanguageCode: null,
      sourceLanguage: null,
      toolbarTargetLanguage: null,
      activeLanguage: null,
      targetLanguage: null,
      isSourceSelected: false,
      usesAlternateTarget: false,
    };
  }

  const {
    selectedSourceLanguageCode: sourceLanguageCode,
    selectedTargetLanguageCode: toolbarTargetLanguageCode,
  } = normalizeLanguageSelections(
    languages,
    chapterState?.selectedSourceLanguageCode,
    chapterState?.selectedTargetLanguageCode,
  );
  const sourceLanguage = languages.find((language) => language.code === sourceLanguageCode) ?? null;
  const toolbarTargetLanguage =
    languages.find((language) => language.code === toolbarTargetLanguageCode) ?? null;
  const activeLanguage =
    languages.find((language) => language.code === chapterState?.activeLanguageCode) ?? null;
  const targetLanguage = activeLanguage ?? toolbarTargetLanguage;
  const targetLanguageCode = targetLanguage?.code ?? null;

  return {
    languages,
    sourceLanguageCode,
    toolbarTargetLanguageCode,
    targetLanguageCode,
    sourceLanguage,
    toolbarTargetLanguage,
    activeLanguage,
    targetLanguage,
    isSourceSelected:
      Boolean(sourceLanguage?.code) && sourceLanguage.code === activeLanguage?.code,
    usesAlternateTarget:
      Boolean(sourceLanguage?.code)
      && Boolean(toolbarTargetLanguage?.code)
      && Boolean(targetLanguage?.code)
      && targetLanguage.code !== sourceLanguage.code
      && targetLanguage.code !== toolbarTargetLanguage.code,
  };
}
