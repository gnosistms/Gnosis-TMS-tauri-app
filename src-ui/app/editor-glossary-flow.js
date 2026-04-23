import { buildEditorGlossaryModel } from "./editor-glossary-highlighting.js";
import { buildEditorRowSearchHighlightMap } from "./editor-search-flow.js";
import { buildEditorSearchHighlightKey } from "./editor-search-highlighting.js";
import {
  buildCachedEditorRowGlossaryHighlights,
  readCachedEditorRowGlossaryHighlights,
  renderableEditorGlossaryHighlightHtml,
} from "./editor-glossary-highlight-cache.js";
import {
  renderSanitizedInlineMarkupWithEditorHighlightState,
  renderSanitizedInlineMarkupWithGlossaryHighlightHtml,
} from "./editor-inline-markup.js";
import { findEditorRowById } from "./editor-utils.js";
import { invoke } from "./runtime.js";
import { createEditorChapterGlossaryState, state } from "./state.js";

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


function setElementInnerHtmlIfChanged(element, html) {
  if (!(element instanceof HTMLElement)) {
    return;
  }

  const nextHtml = typeof html === "string" ? html : "";
  if (element.innerHTML === nextHtml) {
    return;
  }

  element.innerHTML = nextHtml;
}

function readEditorHighlightableText(row, languageCode, contentKind = "field") {
  if (contentKind === "footnote") {
    return row?.footnotes?.[languageCode] ?? "";
  }

  return row?.fields?.[languageCode] ?? "";
}

function applyEditorTextHighlightLayersToRowCard(
  rowCard,
  row,
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
    const glossaryHighlightHtml = isAiTranslating ? "" : renderableEditorGlossaryHighlightHtml(glossaryHighlight);
    const searchHighlightHtml =
      isAiTranslating !== true && typeof searchHighlight?.html === "string"
        ? searchHighlight.html
        : "";
    const searchHighlightRanges = isAiTranslating
      ? []
      : (Array.isArray(searchHighlight?.ranges) ? searchHighlight.ranges : []);
    const highlightableText = readEditorHighlightableText(row, languageCode, contentKind);
    const displayText = stack.querySelector("[data-editor-display-text]");
    const suppressGlossaryWhileEditing =
      contentKind === "field" && !(displayText instanceof HTMLElement);
    const glossaryLayer = stack.querySelector("[data-editor-glossary-highlight]");
    const searchLayer = stack.querySelector("[data-editor-search-highlight]");
    const effectiveGlossaryHighlightHtml =
      suppressGlossaryWhileEditing ? "" : glossaryHighlightHtml;
    const hasLayerGlossary =
      glossaryLayer instanceof HTMLElement && effectiveGlossaryHighlightHtml.length > 0;
    const hasLayerSearch =
      searchLayer instanceof HTMLElement && searchHighlightHtml.length > 0;
    stack.classList.toggle(
      "translation-language-panel__field-stack--highlighted",
      hasLayerGlossary || hasLayerSearch,
    );
    stack.classList.toggle("translation-language-panel__field-stack--glossary", hasLayerGlossary);
    stack.classList.toggle("translation-language-panel__field-stack--search", hasLayerSearch);
    setElementInnerHtmlIfChanged(
      glossaryLayer,
      hasLayerGlossary
        ? renderSanitizedInlineMarkupWithGlossaryHighlightHtml(
          highlightableText,
          effectiveGlossaryHighlightHtml,
        )
        : "",
    );

    if (displayText instanceof HTMLElement) {
      if (!isAiTranslating) {
        setElementInnerHtmlIfChanged(
          displayText,
          renderSanitizedInlineMarkupWithEditorHighlightState(highlightableText, {
            glossaryHighlightHtml,
            searchRanges: searchHighlightRanges,
          }),
        );
      }
    }

    setElementInnerHtmlIfChanged(searchLayer, hasLayerSearch ? searchHighlightHtml : "");
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
  applyEditorTextHighlightLayersToRowCard(rowCard, row, searchHighlightMap, glossaryHighlightMap);
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
    applyEditorTextHighlightLayersToRowCard(rowCard, row, searchHighlightMap, glossaryHighlightMap);
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
