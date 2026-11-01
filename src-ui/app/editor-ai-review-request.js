import { buildEditorAiTranslationGlossaryHints } from "./editor-glossary-highlighting.js";
import {
  buildBatchSourceContext,
  buildRowSourceContextWindow,
} from "./editor-ai-context-window.js";
import {
  buildBatchGlossaryHints,
  rowIdsAreAdjacentCues,
  subtitleCuePositions,
} from "./editor-ai-batch-request.js";
import { editorFootnotesForAiReview } from "./editor-footnotes.js";
import { editorRowGlossaryTermPairs } from "./editor-glossary-highlight-cache.js";
import { editorFootnotesPlainText } from "./editor-utils.js";
import { languageBaseCode } from "./editor-language-utils.js";
import { srtLinguisticRow } from "./editor-srt-grouping.js";

// "clarity" is AI Review All's "Identify parts that are difficult to
// understand": target text only, flags and comments, never edits.
// See plans/ai-review-clarity-flags-plan.md.
export const EDITOR_AI_REVIEW_MODE_CLARITY = "clarity";

export function normalizeEditorAiReviewMode(value) {
  const mode = String(value ?? "").trim();
  return mode === "meaning" || mode === EDITOR_AI_REVIEW_MODE_CLARITY ? mode : "grammar";
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

export function readEditorReviewRowFootnotes(row, languageCode) {
  if (!languageCode) {
    return [];
  }
  return editorFootnotesForAiReview(row?.footnotes?.[languageCode]);
}

export function readEditorReviewRowImageCaption(row, languageCode) {
  if (!languageCode) {
    return "";
  }
  return typeof row?.imageCaptions?.[languageCode] === "string"
    ? row.imageCaptions[languageCode]
    : String(row?.imageCaptions?.[languageCode] ?? "");
}

// cyrb53: a fast, well-mixed 53-bit string hash.
function hashString(value) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

// Identifies the content an AI Review clarity comment was written about, so a
// repeat run skips rows nobody has edited since. Rust stores and returns it
// unchanged; it is only ever compared with values from this function.
export function editorAiReviewContentFingerprint(row, languageCode) {
  return hashString([
    readEditorReviewRowFieldText(row, languageCode),
    readEditorReviewRowFootnote(row, languageCode),
    readEditorReviewRowImageCaption(row, languageCode),
  ].join("\u0000"));
}

// The glossary terms underlined in the rows' target text, so the clarity
// review does not flag a row merely for using approved terminology.
function clarityGlossaryTerms(chapterState, rows, targetLanguageCode) {
  const terms = [];
  const seen = new Set();
  for (const row of rows) {
    for (const term of editorRowGlossaryTermPairs(row, targetLanguageCode, chapterState)) {
      const key = `${term.sourceTerm}\u0000${term.targetTerm}`.toLocaleLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        terms.push(term);
      }
    }
  }
  return terms;
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
  qaHints = [],
  installationId = null,
}) {
  const normalizedReviewMode = normalizeEditorAiReviewMode(reviewMode);
  const clarity = normalizedReviewMode === EDITOR_AI_REVIEW_MODE_CLARITY;
  const rowId = rowIdentity(row);
  const sourceLanguage = editorReviewLanguageByCode(chapterState, sourceLanguageCode);
  const targetLanguage = editorReviewLanguageByCode(chapterState, targetLanguageCode);
  const latestTranslation = readEditorReviewRowFieldText(row, targetLanguageCode);
  const request = {
    providerId,
    modelId,
    reviewMode: normalizedReviewMode,
    // Splits the clarity context window into the rows before and after.
    ...(clarity ? { rowId } : {}),
    text: latestTranslation,
    latestTranslation,
    footnotes: readEditorReviewRowFootnotes(row, targetLanguageCode),
    imageCaption: readEditorReviewRowImageCaption(row, targetLanguageCode),
    sourceText: clarity ? "" : readEditorReviewRowFieldText(row, sourceLanguageCode),
    sourceFootnotes: normalizedReviewMode === "meaning"
      ? readEditorReviewRowFootnotes(row, sourceLanguageCode)
      : [],
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
    ...(clarity ? { glossaryTerms: clarityGlossaryTerms(chapterState, [row], targetLanguageCode) } : {}),
    qaHints: Array.isArray(qaHints) ? qaHints : [],
    alternateLanguageTexts: normalizedReviewMode === "meaning"
      ? buildEditorAiReviewAlternateLanguageTexts(chapterState, row, sourceLanguageCode, targetLanguageCode)
      : [],
    // The clarity window is sized and filled from the target text: its reader
    // never sees the source.
    rowWindow: normalizedReviewMode === "meaning"
      ? buildRowSourceContextWindow(chapterState, rowId, sourceLanguageCode, targetLanguageCode)
      : clarity
        ? buildRowSourceContextWindow(chapterState, rowId, targetLanguageCode, targetLanguageCode)
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
  qaHintsByRowId = new Map(),
  installationId = null,
}) {
  const normalizedReviewMode = normalizeEditorAiReviewMode(reviewMode);
  const meaning = normalizedReviewMode === "meaning";
  const clarity = normalizedReviewMode === EDITOR_AI_REVIEW_MODE_CLARITY;
  const rowList = Array.isArray(rows) ? rows : [];
  const sourceLanguage = editorReviewLanguageByCode(chapterState, sourceLanguageCode);
  const targetLanguage = editorReviewLanguageByCode(chapterState, targetLanguageCode);

  const rowInputs = rowList.map((row) => {
    const rowId = rowIdentity(row);
    return {
      rowId,
      latestTranslation: readEditorReviewRowFieldText(row, targetLanguageCode),
      footnotes: readEditorReviewRowFootnotes(row, targetLanguageCode),
      imageCaption: readEditorReviewRowImageCaption(row, targetLanguageCode),
      sourceText: meaning ? readEditorReviewRowFieldText(row, sourceLanguageCode) : "",
      sourceFootnotes: meaning ? readEditorReviewRowFootnotes(row, sourceLanguageCode) : [],
      sourceImageCaption: meaning ? readEditorReviewRowImageCaption(row, sourceLanguageCode) : "",
      alternateLanguageTexts: meaning
        ? buildEditorAiReviewAlternateLanguageTexts(chapterState, row, sourceLanguageCode, targetLanguageCode)
        : [],
      targetLanguageHistory: meaning
        ? (targetLanguageHistoryByRowId.get(rowId) ?? [])
        : [],
      qaHints: qaHintsByRowId.get(rowId) ?? [],
    };
  });

  const glossaryHints = meaning
    ? buildBatchGlossaryHints(
      rowList.map((row) => readEditorReviewRowFieldText(srtLinguisticRow(row, chapterState), sourceLanguageCode)),
      languageBaseCode(sourceLanguage),
      languageBaseCode(targetLanguage),
      chapterState?.glossary?.matcherModel ?? null,
    )
    : [];

  // Clarity context is sized and filled from the target text (see the single-row
  // request above).
  const contextLanguageCode = clarity ? targetLanguageCode : sourceLanguageCode;
  const { contextBefore, contextAfter } = (meaning || clarity) && rowList.length > 0
    ? buildBatchSourceContext(
      chapterState,
      rowIdentity(rowList[0]),
      rowIdentity(rowList[rowList.length - 1]),
      contextLanguageCode,
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
    ...(clarity ? { glossaryTerms: clarityGlossaryTerms(chapterState, rowList, targetLanguageCode) } : {}),
    contextBefore,
    contextAfter,
    rows: rowInputs,
  };
  // Translate All may have moved words between adjacent subtitle cues, so a
  // meaning review of such rows must read them together with their neighbours.
  if (
    meaning
    && rowIdsAreAdjacentCues(subtitleCuePositions(chapterState), rowInputs.map((row) => row.rowId))
  ) {
    request.subtitleCues = true;
  }
  return Number.isFinite(installationId)
    ? { ...request, installationId }
    : request;
}
