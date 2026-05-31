import { buildEditorAiTranslationGlossaryHints } from "./editor-glossary-highlighting.js";
import { editorFootnotesPlainText } from "./editor-utils.js";
import { languageBaseCode } from "./editor-language-utils.js";

const REVIEW_SOURCE_CONTEXT_PREVIOUS_TOKEN_TARGET = 360;
const REVIEW_SOURCE_CONTEXT_NEXT_TOKEN_TARGET = 220;

export function normalizeEditorAiReviewMode(value) {
  return String(value ?? "").trim() === "meaning" ? "meaning" : "grammar";
}

export function readEditorReviewRowFieldText(row, languageCode) {
  if (!languageCode) {
    return "";
  }
  return typeof row?.fields?.[languageCode] === "string"
    ? row.fields[languageCode]
    : String(row?.fields?.[languageCode] ?? "");
}

export function readEditorReviewRowFootnote(row, languageCode) {
  if (!languageCode) {
    return "";
  }
  return editorFootnotesPlainText(row?.footnotes?.[languageCode]);
}

export function readEditorReviewRowImageCaption(row, languageCode) {
  if (!languageCode) {
    return "";
  }
  return typeof row?.imageCaptions?.[languageCode] === "string"
    ? row.imageCaptions[languageCode]
    : String(row?.imageCaptions?.[languageCode] ?? "");
}

function estimateReviewContextTokens(value) {
  return Math.ceil(String(value ?? "").length / 4);
}

function normalizeReviewLanguageLabel(language, fallbackCode = "") {
  const name = typeof language?.name === "string" ? language.name.trim() : "";
  return name || fallbackCode;
}

function rowIdentity(row) {
  return String(row?.rowId ?? row?.id ?? "").trim();
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

export function buildEditorAiReviewAlternateLanguageTexts(
  chapterState,
  row,
  sourceLanguageCode,
  targetLanguageCode,
) {
  const normalizedSourceLanguageCode = String(sourceLanguageCode ?? "").trim();
  const normalizedTargetLanguageCode = String(targetLanguageCode ?? "").trim();
  return (Array.isArray(chapterState?.languages) ? chapterState.languages : [])
    .map((language) => {
      const languageCode = String(language?.code ?? "").trim();
      return {
        languageCode,
        languageLabel: normalizeReviewLanguageLabel(language, languageCode),
        text: readEditorReviewRowFieldText(row, languageCode),
      };
    })
    .filter((entry) =>
      entry.languageCode
      && entry.languageCode !== normalizedSourceLanguageCode
      && entry.languageCode !== normalizedTargetLanguageCode
      && entry.text.trim()
    );
}

export function buildEditorAiReviewSourceContextWindow(
  chapterState,
  rowId,
  sourceLanguageCode,
  targetLanguageCode,
) {
  const rows = Array.isArray(chapterState?.rows) ? chapterState.rows : [];
  const normalizedRowId = String(rowId ?? "").trim();
  const rowIndex = rows.findIndex((row) => rowIdentity(row) === normalizedRowId);
  if (rowIndex < 0) {
    return [];
  }

  const previousRows = [];
  let previousTokenCount = 0;
  for (
    let index = rowIndex - 1;
    index >= 0 && previousTokenCount < REVIEW_SOURCE_CONTEXT_PREVIOUS_TOKEN_TARGET;
    index -= 1
  ) {
    const row = rows[index];
    previousRows.unshift(row);
    previousTokenCount += estimateReviewContextTokens(
      readEditorReviewRowFieldText(row, sourceLanguageCode),
    );
  }

  const nextRows = [];
  let nextTokenCount = 0;
  for (
    let index = rowIndex + 1;
    index < rows.length && nextTokenCount < REVIEW_SOURCE_CONTEXT_NEXT_TOKEN_TARGET;
    index += 1
  ) {
    const row = rows[index];
    nextRows.push(row);
    nextTokenCount += estimateReviewContextTokens(
      readEditorReviewRowFieldText(row, sourceLanguageCode),
    );
  }

  return [
    ...previousRows,
    rows[rowIndex],
    ...nextRows,
  ].map((row) => ({
    rowId: rowIdentity(row),
    sourceText: readEditorReviewRowFieldText(row, sourceLanguageCode),
    targetText: readEditorReviewRowFieldText(row, targetLanguageCode),
  }));
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
  targetLanguageHistory = [],
  installationId = null,
}) {
  const normalizedReviewMode = normalizeEditorAiReviewMode(reviewMode);
  const rowId = rowIdentity(row);
  const sourceLanguage = editorReviewLanguageByCode(chapterState, sourceLanguageCode);
  const targetLanguage = editorReviewLanguageByCode(chapterState, targetLanguageCode);
  const latestTranslation = readEditorReviewRowFieldText(row, targetLanguageCode);
  const request = {
    providerId,
    modelId,
    reviewMode: normalizedReviewMode,
    text: latestTranslation,
    latestTranslation,
    footnote: readEditorReviewRowFootnote(row, targetLanguageCode),
    imageCaption: readEditorReviewRowImageCaption(row, targetLanguageCode),
    sourceText: readEditorReviewRowFieldText(row, sourceLanguageCode),
    sourceFootnote: normalizedReviewMode === "meaning"
      ? readEditorReviewRowFootnote(row, sourceLanguageCode)
      : "",
    sourceImageCaption: normalizedReviewMode === "meaning"
      ? readEditorReviewRowImageCaption(row, sourceLanguageCode)
      : "",
    sourceLanguageCode,
    targetLanguageCode,
    sourceLanguage: normalizeReviewLanguageLabel(sourceLanguage, sourceLanguageCode),
    targetLanguage: normalizeReviewLanguageLabel(targetLanguage, targetLanguageCode),
    languageCode: languageBaseCode(targetLanguage) || targetLanguageCode,
    glossaryHints: normalizedReviewMode === "meaning"
      ? buildEditorAiReviewGlossaryHints(chapterState, row, sourceLanguageCode, targetLanguageCode)
      : [],
    alternateLanguageTexts: normalizedReviewMode === "meaning"
      ? buildEditorAiReviewAlternateLanguageTexts(chapterState, row, sourceLanguageCode, targetLanguageCode)
      : [],
    rowWindow: normalizedReviewMode === "meaning"
      ? buildEditorAiReviewSourceContextWindow(chapterState, rowId, sourceLanguageCode, targetLanguageCode)
      : [],
    targetLanguageHistory: normalizedReviewMode === "meaning" && Array.isArray(targetLanguageHistory)
      ? targetLanguageHistory
      : [],
  };
  return Number.isFinite(installationId)
    ? { ...request, installationId }
    : request;
}
