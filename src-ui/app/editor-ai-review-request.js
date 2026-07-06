import { buildEditorAiTranslationGlossaryHints } from "./editor-glossary-highlighting.js";
import {
  buildBatchSourceContext,
  buildRowSourceContextWindow,
} from "./editor-ai-context-window.js";
import { buildBatchGlossaryHints } from "./editor-ai-batch-request.js";
import { editorFootnotesPlainText } from "./editor-utils.js";
import { languageBaseCode } from "./editor-language-utils.js";

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
      ? buildRowSourceContextWindow(chapterState, rowId, sourceLanguageCode, targetLanguageCode)
      : [],
    targetLanguageHistory: normalizedReviewMode === "meaning" && Array.isArray(targetLanguageHistory)
      ? targetLanguageHistory
      : [],
  };
  return Number.isFinite(installationId)
    ? { ...request, installationId }
    : request;
}

export function buildEditorAiReviewBatchRequest({
  chapterState,
  rows,
  sourceLanguageCode,
  targetLanguageCode,
  providerId,
  modelId,
  reviewMode,
  targetLanguageHistoryByRowId = new Map(),
  installationId = null,
}) {
  const normalizedReviewMode = normalizeEditorAiReviewMode(reviewMode);
  const meaning = normalizedReviewMode === "meaning";
  const rowList = Array.isArray(rows) ? rows : [];
  const sourceLanguage = editorReviewLanguageByCode(chapterState, sourceLanguageCode);
  const targetLanguage = editorReviewLanguageByCode(chapterState, targetLanguageCode);

  const rowInputs = rowList.map((row) => {
    const rowId = rowIdentity(row);
    return {
      rowId,
      latestTranslation: readEditorReviewRowFieldText(row, targetLanguageCode),
      footnote: readEditorReviewRowFootnote(row, targetLanguageCode),
      imageCaption: readEditorReviewRowImageCaption(row, targetLanguageCode),
      sourceText: meaning ? readEditorReviewRowFieldText(row, sourceLanguageCode) : "",
      sourceFootnote: meaning ? readEditorReviewRowFootnote(row, sourceLanguageCode) : "",
      sourceImageCaption: meaning ? readEditorReviewRowImageCaption(row, sourceLanguageCode) : "",
      alternateLanguageTexts: meaning
        ? buildEditorAiReviewAlternateLanguageTexts(chapterState, row, sourceLanguageCode, targetLanguageCode)
        : [],
      targetLanguageHistory: meaning
        ? (targetLanguageHistoryByRowId.get(rowId) ?? [])
        : [],
    };
  });

  const glossaryHints = meaning
    ? buildBatchGlossaryHints(
      rowInputs.map((row) => row.sourceText),
      languageBaseCode(sourceLanguage),
      languageBaseCode(targetLanguage),
      chapterState?.glossary?.matcherModel ?? null,
    )
    : [];

  const { contextBefore, contextAfter } = meaning && rowList.length > 0
    ? buildBatchSourceContext(
      chapterState,
      rowIdentity(rowList[0]),
      rowIdentity(rowList[rowList.length - 1]),
      sourceLanguageCode,
      targetLanguageCode,
    )
    : { contextBefore: [], contextAfter: [] };

  const request = {
    providerId,
    modelId,
    reviewMode: normalizedReviewMode,
    sourceLanguageCode,
    targetLanguageCode,
    languageCode: languageBaseCode(targetLanguage) || targetLanguageCode,
    sourceLanguage: normalizeReviewLanguageLabel(sourceLanguage, sourceLanguageCode),
    targetLanguage: normalizeReviewLanguageLabel(targetLanguage, targetLanguageCode),
    glossaryHints,
    contextBefore,
    contextAfter,
    rows: rowInputs,
  };
  return Number.isFinite(installationId)
    ? { ...request, installationId }
    : request;
}
