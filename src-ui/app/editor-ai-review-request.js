import { buildEditorAiTranslationGlossaryHints } from "./editor-glossary-highlighting.js";
import { languageBaseCode } from "./editor-language-utils.js";

export function normalizeEditorAiReviewMode(value) {
  return value === "meaning" ? "meaning" : "grammar";
}

export function readEditorReviewRowFieldText(row, languageCode) {
  if (!languageCode) {
    return "";
  }
  return typeof row?.fields?.[languageCode] === "string"
    ? row.fields[languageCode]
    : String(row?.fields?.[languageCode] ?? "");
}

export function selectedEditorReviewSourceLanguageCode(chapterState) {
  const selectedCode = String(chapterState?.selectedSourceLanguageCode ?? "").trim();
  if (selectedCode) {
    return selectedCode;
  }
  return (Array.isArray(chapterState?.languages) ? chapterState.languages : [])
    .find((language) => language?.role === "source")?.code
    ?? chapterState?.languages?.[0]?.code
    ?? "";
}

export function selectedEditorReviewTargetLanguageCode(chapterState) {
  const selectedCode = String(chapterState?.selectedTargetLanguageCode ?? "").trim();
  if (selectedCode) {
    return selectedCode;
  }
  const sourceCode = selectedEditorReviewSourceLanguageCode(chapterState);
  return (Array.isArray(chapterState?.languages) ? chapterState.languages : [])
    .find((language) => language?.code && language.code !== sourceCode)?.code
    ?? "";
}

export function editorReviewLanguageByCode(chapterState, languageCode) {
  const code = String(languageCode ?? "").trim();
  return (Array.isArray(chapterState?.languages) ? chapterState.languages : [])
    .find((language) => language?.code === code) ?? null;
}

export function buildEditorAiReviewGlossaryHints(
  chapterState,
  row,
  sourceLanguageCode,
  targetLanguageCode,
) {
  const glossaryState = chapterState?.glossary ?? null;
  const glossaryModel = glossaryState?.matcherModel ?? null;
  const glossarySourceLanguageCode =
    String(glossaryState?.sourceLanguage?.code ?? glossaryModel?.sourceLanguage?.code ?? "").trim();
  const glossaryTargetLanguageCode =
    String(glossaryState?.targetLanguage?.code ?? glossaryModel?.targetLanguage?.code ?? "").trim();
  const sourceLanguage = editorReviewLanguageByCode(chapterState, sourceLanguageCode);
  const targetLanguage = editorReviewLanguageByCode(chapterState, targetLanguageCode);
  if (
    !glossaryModel
    || glossarySourceLanguageCode !== languageBaseCode(sourceLanguage)
    || glossaryTargetLanguageCode !== languageBaseCode(targetLanguage)
  ) {
    return [];
  }
  return buildEditorAiTranslationGlossaryHints(
    readEditorReviewRowFieldText(row, sourceLanguageCode),
    languageBaseCode(sourceLanguage),
    languageBaseCode(targetLanguage),
    glossaryModel,
  );
}

export function buildEditorAiReviewRequest({
  chapterState,
  row,
  sourceLanguageCode,
  targetLanguageCode,
  providerId,
  modelId,
  reviewMode,
  installationId = null,
}) {
  const normalizedReviewMode = normalizeEditorAiReviewMode(reviewMode);
  const targetLanguage = editorReviewLanguageByCode(chapterState, targetLanguageCode);
  const latestTranslation = readEditorReviewRowFieldText(row, targetLanguageCode);
  const request = {
    providerId,
    modelId,
    reviewMode: normalizedReviewMode,
    text: latestTranslation,
    latestTranslation,
    sourceText: readEditorReviewRowFieldText(row, sourceLanguageCode),
    languageCode: languageBaseCode(targetLanguage) || targetLanguageCode,
    glossaryHints: normalizedReviewMode === "meaning"
      ? buildEditorAiReviewGlossaryHints(chapterState, row, sourceLanguageCode, targetLanguageCode)
      : [],
  };
  return Number.isFinite(installationId)
    ? { ...request, installationId }
    : request;
}
