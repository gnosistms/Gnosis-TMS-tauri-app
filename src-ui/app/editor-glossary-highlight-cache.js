import { buildEditorRowGlossaryHighlights } from "./editor-glossary-highlighting.js";
import { resolveHighlightableEditorDerivedGlossaryEntry } from "./editor-derived-glossary-state.js";
import { isCustomHtmlRowTextStyle } from "./editor-row-text-style.js";
import {
  languageBaseCode,
  languageBaseCodesMatch,
  languageMatchesBaseCode,
} from "./editor-language-utils.js";
import { state } from "./state.js";

const EDITOR_GLOSSARY_HIGHLIGHT_CACHE_LIMIT = 400;

let editorGlossaryHighlightCacheContextKey = "";
let editorGlossaryHighlightCacheMatcherModel = null;
const editorGlossaryHighlightCache = new Map();
// One small diagnostic per row in the current chapter, independent of the
// bounded viewport HTML cache. Sequential chapter scans must not evict each other.
const editorGlossaryErrorCache = new Map();
let editorGlossaryErrorCacheRows = null;

function buildEditorRowSections(row, chapterState = state.editorChapter) {
  return (Array.isArray(chapterState?.languages) ? chapterState.languages : []).map((language) => ({
    code: language.code,
    baseCode: languageBaseCode(language),
    text: row?.fields?.[language.code] ?? "",
  }));
}

function editorGlossaryHighlightContextKey(chapterState = state.editorChapter) {
  const glossaryId = chapterState?.glossary?.glossaryId ?? "";
  const repoName = chapterState?.glossary?.repoName ?? "";
  return `${chapterState?.chapterId ?? ""}::${glossaryId}::${repoName}`;
}

function synchronizeEditorGlossaryHighlightCache(chapterState = state.editorChapter) {
  const nextContextKey = editorGlossaryHighlightContextKey(chapterState);
  const nextMatcherModel = chapterState?.glossary?.matcherModel ?? null;
  if (
    nextContextKey === editorGlossaryHighlightCacheContextKey
    && nextMatcherModel === editorGlossaryHighlightCacheMatcherModel
  ) {
    return;
  }

  editorGlossaryHighlightCacheContextKey = nextContextKey;
  editorGlossaryHighlightCacheMatcherModel = nextMatcherModel;
  editorGlossaryHighlightCache.clear();
  editorGlossaryErrorCache.clear();
  editorGlossaryErrorCacheRows = null;
}

function buildEditorRowGlossaryHighlightCacheKey(row, chapterState = state.editorChapter) {
  const rowId = typeof row?.rowId === "string" && row.rowId.trim() ? row.rowId.trim() : "";
  if (!rowId) {
    return "";
  }

  const glossaryModel = chapterState?.glossary?.matcherModel ?? null;
  let directSegment = "";
  if (glossaryModel?.sourceLanguage?.code) {
    const sourceCode = glossaryModel.sourceLanguage.code;
    const targetCode = glossaryModel.targetLanguage?.code ?? "";
    const languageTexts = (Array.isArray(chapterState?.languages) ? chapterState.languages : [])
      .filter((language) => {
        return languageMatchesBaseCode(language, sourceCode)
          || languageMatchesBaseCode(language, targetCode);
      })
      .map((language) => `${language.code}:${String(row?.fields?.[language.code] ?? "")}`)
      .join("::");
    directSegment = `::direct:${sourceCode}:${targetCode}:${languageTexts}`;
  }

  const derivedGlossaryEntry = resolveHighlightableEditorDerivedGlossaryEntry(
    chapterState,
    rowId,
    row,
  );
  const derivedSourceCode = derivedGlossaryEntry?.matcherModel?.sourceLanguage?.code ?? "";
  const derivedTargetCode = derivedGlossaryEntry?.matcherModel?.targetLanguage?.code ?? "";
  const derivedSourceText = derivedSourceCode ? String(row?.fields?.[derivedSourceCode] ?? "") : "";
  const derivedTargetText = derivedTargetCode ? String(row?.fields?.[derivedTargetCode] ?? "") : "";
  const derivedSegment = derivedGlossaryEntry
    ? `::derived:${derivedGlossaryEntry.requestKey ?? ""}:${derivedSourceCode}:${derivedSourceText}::${derivedTargetCode}:${derivedTargetText}`
    : "";

  if (!directSegment && !derivedSegment) {
    return "";
  }

  return `${rowId}${directSegment}${derivedSegment}`;
}

function cacheEditorGlossaryHighlightResult(cacheKey, highlightMap) {
  if (!cacheKey) {
    return;
  }

  editorGlossaryHighlightCache.set(cacheKey, highlightMap);
  if (editorGlossaryHighlightCache.size <= EDITOR_GLOSSARY_HIGHLIGHT_CACHE_LIMIT) {
    return;
  }

  const oldestKey = editorGlossaryHighlightCache.keys().next().value;
  if (oldestKey) {
    editorGlossaryHighlightCache.delete(oldestKey);
  }
}

export function buildCachedEditorRowGlossaryHighlights(row, chapterState = state.editorChapter) {
  synchronizeEditorGlossaryHighlightCache(chapterState);

  const glossaryModel = chapterState?.glossary?.matcherModel ?? null;
  const cacheKey = buildEditorRowGlossaryHighlightCacheKey(row, chapterState);
  if (!glossaryModel && !cacheKey) {
    return new Map();
  }

  if (cacheKey && editorGlossaryHighlightCache.has(cacheKey)) {
    return editorGlossaryHighlightCache.get(cacheKey);
  }

  const derivedGlossaryEntry = resolveHighlightableEditorDerivedGlossaryEntry(
    chapterState,
    row?.rowId ?? "",
    row,
  );
  const highlightMap = buildMergedEditorRowGlossaryHighlights(
    buildEditorRowSections(row, chapterState), glossaryModel, derivedGlossaryEntry?.matcherModel,
  );
  cacheEditorGlossaryHighlightResult(cacheKey, highlightMap);
  return highlightMap;
}

function buildMergedEditorRowGlossaryHighlights(sections, glossaryModel, derivedModel, options) {
  const directTargetLanguageCode = glossaryModel?.targetLanguage?.code ?? "";
  const highlightMap = new Map();
  if (glossaryModel) {
    for (const [languageCode, nextHighlight] of buildEditorRowGlossaryHighlights(
      sections,
      glossaryModel,
      options,
    )) {
      highlightMap.set(languageCode, nextHighlight);
    }
  }

  if (derivedModel) {
    for (const [languageCode, nextHighlight] of buildEditorRowGlossaryHighlights(
      sections,
      derivedModel,
      options,
    )) {
      if (
        languageBaseCodesMatch({ code: languageCode }, { code: directTargetLanguageCode })
        && highlightMap.has(languageCode)
      ) {
        continue;
      }
      highlightMap.set(languageCode, nextHighlight);
    }
  }

  return highlightMap;
}

export function editorRowHasGlossaryError(row, chapterState = state.editorChapter) {
  if (isCustomHtmlRowTextStyle(row?.textStyle)) {
    return false;
  }
  synchronizeEditorGlossaryHighlightCache(chapterState);
  if (editorGlossaryErrorCacheRows !== chapterState?.rows) {
    editorGlossaryErrorCacheRows = chapterState?.rows;
    const rowIds = new Set((chapterState?.rows ?? []).map((item) => item.rowId));
    for (const rowId of editorGlossaryErrorCache.keys()) {
      if (!rowIds.has(rowId)) editorGlossaryErrorCache.delete(rowId);
    }
  }

  const glossaryModel = chapterState?.glossary?.matcherModel ?? null;
  const derivedModel = resolveHighlightableEditorDerivedGlossaryEntry(
    chapterState, row?.rowId ?? "", row,
  )?.matcherModel ?? null;
  if (!glossaryModel && !derivedModel) return false;

  const sections = buildEditorRowSections(row, chapterState);
  const textKey = JSON.stringify(sections);
  const cached = editorGlossaryErrorCache.get(row?.rowId);
  if (cached?.textKey === textKey && cached.derivedModel === derivedModel) {
    return cached.hasErrors;
  }
  const diagnostics = buildMergedEditorRowGlossaryHighlights(
    sections, glossaryModel, derivedModel, { includeMarkup: false },
  );
  const hasErrors = [...diagnostics.values()].some((highlight) => highlight.hasErrors === true);
  if (row?.rowId) {
    editorGlossaryErrorCache.set(row.rowId, { textKey, derivedModel, hasErrors });
  }
  return hasErrors;
}

export function readCachedEditorRowGlossaryHighlights(row, chapterState = state.editorChapter) {
  synchronizeEditorGlossaryHighlightCache(chapterState);

  const cacheKey = buildEditorRowGlossaryHighlightCacheKey(row, chapterState);
  if (!cacheKey || !editorGlossaryHighlightCache.has(cacheKey)) {
    return null;
  }

  return editorGlossaryHighlightCache.get(cacheKey) ?? null;
}

export function renderableEditorGlossaryHighlightHtml(highlight) {
  const highlightHtml = typeof highlight?.html === "string" ? highlight.html : "";
  return highlight?.hasMatches === true && highlightHtml.length > 0 ? highlightHtml : "";
}
