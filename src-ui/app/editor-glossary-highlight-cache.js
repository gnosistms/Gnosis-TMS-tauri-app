import { buildEditorRowGlossaryHighlights } from "./editor-glossary-highlighting.js";
import { resolveHighlightableEditorDerivedGlossaryEntry } from "./editor-derived-glossary-state.js";
import { state } from "./state.js";

const EDITOR_GLOSSARY_HIGHLIGHT_CACHE_LIMIT = 400;

let editorGlossaryHighlightCacheContextKey = "";
let editorGlossaryHighlightCacheMatcherModel = null;
const editorGlossaryHighlightCache = new Map();

function buildEditorRowSections(row, chapterState = state.editorChapter) {
  return (Array.isArray(chapterState?.languages) ? chapterState.languages : []).map((language) => ({
    code: language.code,
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
    const sourceText = String(row?.fields?.[sourceCode] ?? "");
    const targetText = targetCode ? String(row?.fields?.[targetCode] ?? "") : "";
    directSegment = `::direct:${sourceCode}:${sourceText}::${targetCode}:${targetText}`;
  }

  const derivedGlossaryEntry = resolveHighlightableEditorDerivedGlossaryEntry(
    chapterState,
    rowId,
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

  const sections = buildEditorRowSections(row, chapterState);
  const highlightMap = new Map();
  if (glossaryModel) {
    for (const [languageCode, nextHighlight] of buildEditorRowGlossaryHighlights(
      sections,
      glossaryModel,
    )) {
      highlightMap.set(languageCode, nextHighlight);
    }
  }

  const derivedGlossaryEntry = resolveHighlightableEditorDerivedGlossaryEntry(
    chapterState,
    row?.rowId ?? "",
  );
  if (derivedGlossaryEntry?.matcherModel) {
    for (const [languageCode, nextHighlight] of buildEditorRowGlossaryHighlights(
      sections,
      derivedGlossaryEntry.matcherModel,
    )) {
      highlightMap.set(languageCode, nextHighlight);
    }
  }

  cacheEditorGlossaryHighlightResult(cacheKey, highlightMap);
  return highlightMap;
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
