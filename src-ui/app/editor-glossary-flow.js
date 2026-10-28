import { footnoteParagraphsHtml } from "./editor-footnote-paragraphs.js";
import { buildEditorGlossaryModel } from "./editor-glossary-highlighting.js";
import { waitForGlossaryTermWritesToSettle } from "./glossary-term-write-coordinator.js";
import { buildEditorRowSearchHighlightMap } from "./editor-search-flow.js";
import { buildEditorSearchHighlightKey } from "./editor-search-highlighting.js";
import {
  buildCachedEditorRowGlossaryHighlights,
  readCachedEditorRowGlossaryHighlights,
  renderableEditorGlossaryHighlightHtml,
} from "./editor-glossary-highlight-cache.js";
import {
  buildInlineMarkupSearchHighlightMarkup,
  renderSanitizedInlineMarkupWithEditorHighlightState,
  renderSanitizedInlineMarkupWithGlossaryHighlightHtml,
} from "./editor-inline-markup.js";
import { buildStaticInlineFootnoteMarkerRanges } from "./editor-static-footnote-markers.js";
import { isCustomHtmlRowTextStyle } from "./editor-row-text-style.js";
import { editorLanguageFootnotes, findEditorRowById } from "./editor-utils.js";
import { findChapterContextById, selectedProjectsTeam } from "./project-context.js";
import { invoke } from "./runtime.js";
import { createEditorChapterGlossaryState, state } from "./state.js";
import { EDITOR_ROW_FILTER_MODE_HAS_GLOSSARY_ERROR } from "./editor-filters.js";
import { srtLinguisticRow, srtDisplayRowId } from "./editor-srt-grouping.js";
import { renderSrtStaticText } from "./editor-srt-group-render.js";
import { scheduleActiveGlossaryTooltipPlacementUpdate } from "./events/glossary-tooltip.js";
import { refreshEditorDerivedGlossaryMetadata } from "./editor-derived-glossary-state.js";
import { saveStoredEditorDerivedGlossariesForChapter } from "./editor-derived-glossary-cache.js";

const localGlossaryRevisions = new Map();

function localGlossaryKey(team, link) {
  return `${team.installationId}:${link.repoName}:${link.glossaryId}`;
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
    syncInProgress: payload?.syncInProgress === true,
    matcherModel: null,
  };
  glossaryState.matcherModel = buildEditorGlossaryModel(glossaryState);
  return glossaryState;
}

export async function loadEditorGlossaryState(team, chapter, options = {}) {
  const linkedGlossary = normalizeEditorGlossaryLink(chapter?.linkedGlossary);
  if (!linkedGlossary || !Number.isFinite(team?.installationId)) {
    return createEditorChapterGlossaryState();
  }

  const key = localGlossaryKey(team, linkedGlossary);
  for (;;) {
    await waitForGlossaryTermWritesToSettle(team, linkedGlossary.repoName, { localOnly: true });
    const revision = localGlossaryRevisions.get(key);
    try {
      const payload = await invoke("load_gtms_glossary_editor_data", {
        input: {
          installationId: team.installationId,
          glossaryId: linkedGlossary.glossaryId,
          repoName: linkedGlossary.repoName,
          // This view only consumes hints/highlights; editable glossary loads
          // require the default latest mode so stale drafts cannot overwrite sync.
          readMode: options.readMode ?? "localSnapshot",
        },
      });
      // A rollback or a later save may have overtaken this disk read.
      if (revision === localGlossaryRevisions.get(key)) {
        return buildEditorGlossaryStateFromPayload(payload, linkedGlossary);
      }
    } catch (error) {
      // A failed read can also belong to an obsolete snapshot (for example,
      // while rollback replaces term files). Retry the current revision.
      if (revision !== localGlossaryRevisions.get(key)) continue;
      return {
        ...createEditorChapterGlossaryState(),
        status: "error",
        error: error?.message ?? String(error),
        glossaryId: linkedGlossary.glossaryId,
        repoName: linkedGlossary.repoName,
        // A snapshot capture can fail while sync is repairing the repository.
        // Give that first local read one current-data retry after display.
        syncInProgress: options.readMode !== "latest",
      };
    }
  }
}

export async function refreshEditorGlossaryAfterLocalChange(render, team, link, options = {}) {
  const linkedGlossary = normalizeEditorGlossaryLink(link);
  if (!linkedGlossary || !Number.isFinite(team?.installationId)) return;
  const key = localGlossaryKey(team, linkedGlossary);
  const revision = (localGlossaryRevisions.get(key) ?? 0) + 1;
  localGlossaryRevisions.set(key, revision);
  const chapterId = state.editorChapter?.chapterId;
  const matchesContext = () => state.screen === "translate"
    && selectedProjectsTeam()?.id === team.id
    && selectedProjectsTeam()?.installationId === team.installationId
    && state.editorChapter?.chapterId === chapterId
    && ["ready", "refreshing"].includes(state.editorChapter?.status)
    && editorGlossaryStateMatchesLink(state.editorChapter.glossary, linkedGlossary)
    && editorGlossaryStateMatchesLink(linkedGlossary, findChapterContextById(chapterId)?.chapter?.linkedGlossary);
  if (!matchesContext()) return;
  const glossary = await loadEditorGlossaryState(team, { linkedGlossary }, options);
  if (!matchesContext() || localGlossaryRevisions.get(key) !== revision) return;
  const previous = state.editorChapter;
  const derivedGlossariesByRowId = refreshEditorDerivedGlossaryMetadata(
    previous.derivedGlossariesByRowId, previous.glossary, glossary, previous.languages,
  );
  state.editorChapter = { ...previous, glossary, derivedGlossariesByRowId };
  if (derivedGlossariesByRowId !== previous.derivedGlossariesByRowId) {
    saveStoredEditorDerivedGlossariesForChapter(team, previous.projectId, chapterId, derivedGlossariesByRowId);
  }
  // Matcher identity invalidates highlight caches; derived entries already check
  // the glossary content revision. Patch mounted highlights without remounting inputs.
  if (typeof document !== "undefined") {
    syncMountedEditorGlossaryHighlightRows();
    scheduleActiveGlossaryTooltipPlacementUpdate();
  }
  if (state.editorChapter.filters?.rowFilterMode === EDITOR_ROW_FILTER_MODE_HAS_GLOSSARY_ERROR) {
    render?.({ scope: "translate-body" });
  }
  render?.({ scope: "translate-sidebar" });
  refreshEditorGlossaryAfterSync(render, team, glossary);
}

// The first read stays immediate. Only a snapshot-backed result needs a second
// read that waits for the repository lock; the usual context/revision guards
// reject its result if another save, navigation, or link change overtakes it.
export function refreshEditorGlossaryAfterSync(render, team, glossary) {
  if (glossary?.syncInProgress) {
    void refreshEditorGlossaryAfterLocalChange(render, team, glossary, { readMode: "latest" });
  }
}

// A chapter's linked glossary loads asynchronously from local storage when the
// chapter opens (`editor-chapter-load-flow.js`); until that resolves (or if it
// previously failed), `chapterState.glossary` is a placeholder with no matcher
// model. AI features that can be invoked immediately after a chapter opens
// (assistant chat, AI Translate) must (re)fetch a not-yet-ready glossary
// themselves rather than silently treating "not loaded yet" as "no glossary
// terms match". A prior "error" status is retried too, rather than
// permanently disabling glossary hints for the rest of the session over one
// transient failure.
export async function ensureEditorGlossaryReady(chapterState, chapterId) {
  const glossaryState = chapterState?.glossary ?? null;
  if (glossaryState?.status === "ready") {
    return glossaryState;
  }

  const team = selectedProjectsTeam();
  const chapterContext = findChapterContextById(chapterId);
  if (!team || !chapterContext?.chapter?.linkedGlossary) {
    return glossaryState;
  }

  const freshGlossaryState = await loadEditorGlossaryState(team, chapterContext.chapter);
  if (state.editorChapter?.chapterId === chapterId
    && selectedProjectsTeam()?.id === team.id
    && selectedProjectsTeam()?.installationId === team.installationId
    && editorGlossaryStateMatchesLink(freshGlossaryState, findChapterContextById(chapterId)?.chapter?.linkedGlossary)) {
    state.editorChapter = { ...state.editorChapter, glossary: freshGlossaryState };
    refreshEditorGlossaryAfterSync(undefined, team, freshGlossaryState);
  }
  return freshGlossaryState;
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

function readEditorHighlightableText(row, languageCode, contentKind = "field", footnoteMarker = null) {
  if (contentKind === "footnote") {
    return editorLanguageFootnotes(row, languageCode).find((entry) => entry.marker === footnoteMarker)?.text ?? "";
  }
  if (contentKind === "image-caption") {
    return row?.imageCaptions?.[languageCode] ?? "";
  }

  return row?.fields?.[languageCode] ?? "";
}

function applyEditorTextHighlightLayersToRowCard(
  rowCard,
  row,
  searchHighlightMap = new Map(),
  glossaryHighlightMap = new Map(),
  chapterState = state.editorChapter,
) {
  rowCard.querySelectorAll("[data-editor-glossary-field-stack]").forEach((stack) => {
    if (!(stack instanceof HTMLElement)) {
      return;
    }

    // Custom-HTML rows render their (sanitized) raw HTML in the static display and
    // opt out of glossary/search highlighting. Re-running the inline-markup
    // highlighter here would escape the HTML back into visible tags, so skip them.
    if (isCustomHtmlRowTextStyle(stack.dataset.rowTextStyle)) {
      return;
    }

    // A field showing a "Changed after my last edit" diff renders merged text that the
    // highlight layers don't describe; rewriting it would drop the diff.
    if (stack.dataset.editorChangeDiff === "true") {
      return;
    }

    const isAiTranslating = stack.dataset.aiTranslating === "true";
    const languageCode = stack.dataset.languageCode ?? "";
    const contentKind = stack.dataset.contentKind === "footnote"
      ? "footnote"
      : stack.dataset.contentKind === "image-caption" ? "image-caption" : "field";
    // Auxiliary fields retain their own real-row content inside a group card.
    const ownedRow = row.srtGroup?.members.find((member) => member.rowId === stack.dataset.rowId) ?? row;
    const glossaryHighlight = glossaryHighlightMap instanceof Map
      ? (contentKind === "field" ? (glossaryHighlightMap.get(languageCode) ?? null) : null)
      : null;
    const editingField = stack.querySelector("textarea[data-editor-row-field]");
    const highlightableText = contentKind !== "field" && typeof editingField?.value === "string"
      ? editingField.value
      : readEditorHighlightableText(
        contentKind === "field" ? row : ownedRow, languageCode, contentKind,
        Number.parseInt(stack.dataset.footnoteMarker, 10),
      );
    // Match each attachment independently: offsets from a concatenation of all
    // notes cannot be applied to an individual footnote editor or display.
    const searchHighlight = contentKind === "field"
      ? (searchHighlightMap.get(buildEditorSearchHighlightKey(languageCode, contentKind)) ?? null)
      : buildInlineMarkupSearchHighlightMarkup(highlightableText, chapterState?.filters?.searchQuery, languageCode, {
        caseSensitive: chapterState?.filters?.caseSensitive === true,
      });
    const glossaryHighlightHtml = isAiTranslating ? "" : renderableEditorGlossaryHighlightHtml(glossaryHighlight);
    const searchHighlightHtml =
      isAiTranslating !== true && typeof searchHighlight?.html === "string"
        ? searchHighlight.html
        : "";
    const searchHighlightRanges = isAiTranslating
      ? []
      : (Array.isArray(searchHighlight?.ranges) ? searchHighlight.ranges : []);
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
        const displayHtml = row.srtTexts?.[languageCode] && contentKind === "field"
          ? renderSrtStaticText({ code: languageCode, text: row.srtTexts[languageCode].text,
            srtParts: row.srtTexts[languageCode].parts, srtMarkers: row.srtTexts[languageCode].markers,
            searchHighlightRanges: searchHighlightRanges }, glossaryHighlightHtml)
          : renderSanitizedInlineMarkupWithEditorHighlightState(highlightableText, {
            glossaryHighlightHtml,
            searchRanges: searchHighlightRanges,
            extraRanges: contentKind === "field"
              ? buildStaticInlineFootnoteMarkerRanges(
                highlightableText,
                row?.footnotes?.[languageCode],
              )
              : [],
          });
        setElementInnerHtmlIfChanged(displayText, contentKind === "footnote"
          ? footnoteParagraphsHtml(displayHtml) : displayHtml);
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

  const row = srtLinguisticRow(findEditorRowById(rowId, chapterState), chapterState);
  if (!row) {
    return;
  }

  const glossaryHighlightMap = buildCachedEditorRowGlossaryHighlights(row, chapterState);
  const searchHighlightMap = buildEditorRowSearchHighlightMap(row, chapterState);
  applyEditorTextHighlightLayersToRowCard(rowCard, row, searchHighlightMap, glossaryHighlightMap, chapterState);
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

    const row = srtLinguisticRow(findEditorRowById(rowId, chapterState), chapterState);
    if (!row) {
      return;
    }

    const glossaryHighlightMap = computeIfMissing
      ? buildCachedEditorRowGlossaryHighlights(row, chapterState)
      : readCachedEditorRowGlossaryHighlights(row, chapterState);
    const searchHighlightMap = buildEditorRowSearchHighlightMap(row, chapterState);
    applyEditorTextHighlightLayersToRowCard(rowCard, row, searchHighlightMap, glossaryHighlightMap, chapterState);
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
  rowId = srtDisplayRowId(chapterState, rowId);

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
