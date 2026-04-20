import {
  buildEditorGlossaryModel,
  buildEditorRowGlossaryHighlights,
} from "./editor-glossary-highlighting.js";
import {
  resolveHighlightableEditorDerivedGlossaryEntry,
} from "./editor-derived-glossary-state.js";
import { buildEditorRowSearchHighlightMap } from "./editor-search-flow.js";
import { buildEditorSearchHighlightKey } from "./editor-search-highlighting.js";
import { findEditorRowById } from "./editor-utils.js";
import { invoke } from "./runtime.js";
import { createEditorChapterGlossaryState, state } from "./state.js";

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

export function normalizeEditorGlossaryLink(link) {
  if (!link || typeof link !== "object") {
    return null;
  }

  const glossaryId =
    typeof link.glossaryId === "string" && link.glossaryId.trim()
      ? link.glossaryId.trim()
      : null;
  const repoName =
    typeof link.repoName === "string" && link.repoName.trim()
      ? link.repoName.trim()
      : null;
  if (!glossaryId || !repoName) {
    return null;
  }

  return {
    glossaryId,
    repoName,
  };
}

export function editorGlossaryStateMatchesLink(glossaryState, linkedGlossary) {
  const normalizedLink = normalizeEditorGlossaryLink(linkedGlossary);
  if (!normalizedLink) {
    return false;
  }

  return (
    glossaryState?.glossaryId === normalizedLink.glossaryId
    && glossaryState?.repoName === normalizedLink.repoName
  );
}

function buildEditorGlossaryStateFromPayload(payload, linkedGlossary) {
  const normalizedLink = normalizeEditorGlossaryLink(linkedGlossary);
  if (!normalizedLink) {
    return createEditorChapterGlossaryState();
  }

  const normalizedTerms = (Array.isArray(payload?.terms) ? payload.terms : [])
    .filter((term) => term?.lifecycleState !== "deleted");
  const glossaryState = {
    status: "ready",
    error: "",
    glossaryId: payload?.glossaryId ?? normalizedLink.glossaryId,
    repoName: normalizedLink.repoName,
    title: payload?.title ?? "",
    sourceLanguage: payload?.sourceLanguage ?? null,
    targetLanguage: payload?.targetLanguage ?? null,
    terms: normalizedTerms,
    matcherModel: null,
  };
  glossaryState.matcherModel = buildEditorGlossaryModel(glossaryState);
  return glossaryState;
}

export async function loadEditorGlossaryState(team, chapter) {
  const linkedGlossary = normalizeEditorGlossaryLink(chapter?.linkedGlossary);
  if (!linkedGlossary || !Number.isFinite(team?.installationId)) {
    return createEditorChapterGlossaryState();
  }

  try {
    const payload = await invoke("load_gtms_glossary_editor_data", {
      input: {
        installationId: team.installationId,
        glossaryId: linkedGlossary.glossaryId,
        repoName: linkedGlossary.repoName,
      },
    });
    return buildEditorGlossaryStateFromPayload(payload, linkedGlossary);
  } catch (error) {
    return {
      ...createEditorChapterGlossaryState(),
      status: "error",
      error: error?.message ?? String(error),
      glossaryId: linkedGlossary.glossaryId,
      repoName: linkedGlossary.repoName,
    };
  }
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

function buildCachedEditorRowGlossaryHighlights(row, chapterState = state.editorChapter) {
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

function readCachedEditorRowGlossaryHighlights(row, chapterState = state.editorChapter) {
  synchronizeEditorGlossaryHighlightCache(chapterState);

  const cacheKey = buildEditorRowGlossaryHighlightCacheKey(row, chapterState);
  if (!cacheKey || !editorGlossaryHighlightCache.has(cacheKey)) {
    return null;
  }

  return editorGlossaryHighlightCache.get(cacheKey) ?? null;
}

function renderableHighlightHtml(highlight) {
  const highlightHtml = typeof highlight?.html === "string" ? highlight.html : "";
  return highlight?.hasMatches === true && highlightHtml.length > 0 ? highlightHtml : "";
}

function applyEditorTextHighlightLayersToRowCard(
  rowCard,
  searchHighlightMap = new Map(),
  glossaryHighlightMap = new Map(),
) {
  rowCard.querySelectorAll("[data-editor-glossary-field-stack]").forEach((stack) => {
    if (!(stack instanceof HTMLElement)) {
      return;
    }

    const isAiTranslating = stack.dataset.aiTranslating === "true";
    const languageCode = stack.dataset.languageCode ?? "";
    const contentKind = stack.dataset.contentKind === "footnote" ? "footnote" : "field";
    const glossaryHighlight = glossaryHighlightMap instanceof Map
      ? (contentKind === "field" ? (glossaryHighlightMap.get(languageCode) ?? null) : null)
      : null;
    const searchHighlight = searchHighlightMap instanceof Map
      ? (searchHighlightMap.get(buildEditorSearchHighlightKey(languageCode, contentKind)) ?? null)
      : null;
    const glossaryHighlightHtml = isAiTranslating ? "" : renderableHighlightHtml(glossaryHighlight);
    const searchHighlightHtml = isAiTranslating ? "" : renderableHighlightHtml(searchHighlight);
    const hasGlossaryHighlight = glossaryHighlightHtml.length > 0;
    const hasSearchHighlight = searchHighlightHtml.length > 0;
    const hasRenderableHighlight = hasGlossaryHighlight || hasSearchHighlight;

    stack.classList.toggle(
      "translation-language-panel__field-stack--highlighted",
      hasRenderableHighlight,
    );
    stack.classList.toggle(
      "translation-language-panel__field-stack--glossary",
      hasGlossaryHighlight,
    );
    stack.classList.toggle(
      "translation-language-panel__field-stack--search",
      hasSearchHighlight,
    );

    const glossaryLayer = stack.querySelector("[data-editor-glossary-highlight]");
    if (glossaryLayer instanceof HTMLElement) {
      glossaryLayer.innerHTML = glossaryHighlightHtml;
    }

    const displayText = stack.querySelector("[data-editor-display-text]");
    if (displayText instanceof HTMLElement) {
      const plainText = displayText.textContent ?? "";
      displayText.innerHTML = glossaryHighlightHtml || renderableHighlightHtml({
        html: plainText
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;")
          .replaceAll("'", "&#39;"),
        hasMatches: plainText.length > 0,
      });
    }

    const searchLayer = stack.querySelector("[data-editor-search-highlight]");
    if (searchLayer instanceof HTMLElement) {
      searchLayer.innerHTML = searchHighlightHtml;
    }
  });
}

function syncEditorGlossaryHighlightRowCard(rowCard, chapterState = state.editorChapter) {
  const rowId = rowCard?.dataset?.rowId ?? "";
  if (!(rowCard instanceof HTMLElement) || !rowId || !chapterState?.chapterId) {
    return;
  }

  const row = findEditorRowById(rowId, chapterState);
  if (!row) {
    return;
  }

  const glossaryHighlightMap = buildCachedEditorRowGlossaryHighlights(row, chapterState);
  const searchHighlightMap = buildEditorRowSearchHighlightMap(row, chapterState);
  applyEditorTextHighlightLayersToRowCard(rowCard, searchHighlightMap, glossaryHighlightMap);
}

function syncMountedEditorGlossaryHighlightRows(
  root = document,
  chapterState = state.editorChapter,
  options = {},
) {
  if (
    typeof document === "undefined"
    || typeof root?.querySelectorAll !== "function"
    || !chapterState?.chapterId
  ) {
    return;
  }

  const computeIfMissing = options.computeIfMissing !== false;
  const visibleContainer =
    options.visibleContainer instanceof HTMLElement ? options.visibleContainer : null;
  const containerRect = visibleContainer?.getBoundingClientRect?.() ?? null;

  root.querySelectorAll("[data-editor-row-card]").forEach((rowCard) => {
    if (!(rowCard instanceof HTMLElement)) {
      return;
    }

    if (containerRect) {
      const rowRect = rowCard.getBoundingClientRect();
      if (rowRect.bottom <= containerRect.top || rowRect.top >= containerRect.bottom) {
        return;
      }
    }

    const rowId = rowCard.dataset.rowId ?? "";
    if (!rowId) {
      return;
    }

    const row = findEditorRowById(rowId, chapterState);
    if (!row) {
      return;
    }

    const glossaryHighlightMap = computeIfMissing
      ? buildCachedEditorRowGlossaryHighlights(row, chapterState)
      : readCachedEditorRowGlossaryHighlights(row, chapterState);
    const searchHighlightMap = buildEditorRowSearchHighlightMap(row, chapterState);
    applyEditorTextHighlightLayersToRowCard(rowCard, searchHighlightMap, glossaryHighlightMap);
  });
}

export function syncEditorGlossaryHighlightRowDom(
  rowId,
  chapterState = state.editorChapter,
  root = document,
) {
  if (typeof document === "undefined" || !rowId || !chapterState?.chapterId) {
    return;
  }

  const rowCard = root.querySelector(
    `[data-editor-row-card][data-row-id="${CSS.escape(rowId)}"]`,
  );
  if (!(rowCard instanceof HTMLElement)) {
    return;
  }

  syncEditorGlossaryHighlightRowCard(rowCard, chapterState);
}

export function restoreMountedEditorGlossaryHighlightsFromCache(
  root = document,
  chapterState = state.editorChapter,
) {
  syncMountedEditorGlossaryHighlightRows(root, chapterState, {
    computeIfMissing: false,
  });
}

export function syncVisibleEditorGlossaryHighlightRows(
  root = document,
  scrollContainer = root?.querySelector?.(".translate-main-scroll") ?? null,
  chapterState = state.editorChapter,
) {
  if (!(scrollContainer instanceof HTMLElement)) {
    return;
  }

  syncMountedEditorGlossaryHighlightRows(root, chapterState, {
    computeIfMissing: true,
    visibleContainer: scrollContainer,
  });
}
