import { normalizeEditorFieldImage } from "./editor-images.js";
import {
  normalizeEditorFootnotes,
  parseUnescapedFootnoteMarkers,
  unescapeLiteralFootnoteMarkers,
} from "./editor-footnotes.js";
import {
  extractInlineMarkupVisibleText,
  renderSanitizedInlineMarkupHtml,
  renderSanitizedInlineMarkupWithRanges,
  renderSanitizedInlineMarkupWithHighlights,
} from "./editor-inline-markup.js";
import { parseInlineMarkup } from "./editor-inline-markup/parser.js";
import {
  EDITOR_ROW_TEXT_STYLE_CENTERED,
  EDITOR_ROW_TEXT_STYLE_HEADING1,
  EDITOR_ROW_TEXT_STYLE_HEADING2,
  EDITOR_ROW_TEXT_STYLE_INDENTED,
  EDITOR_ROW_TEXT_STYLE_PARAGRAPH,
  EDITOR_ROW_TEXT_STYLE_QUOTE,
  normalizeEditorRowTextStyle,
} from "./editor-row-text-style.js";

export const EDITOR_MODE_TRANSLATE = "translate";
export const EDITOR_MODE_PREVIEW = "preview";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function normalizeEditorMode(value) {
  return value === EDITOR_MODE_PREVIEW
    ? EDITOR_MODE_PREVIEW
    : EDITOR_MODE_TRANSLATE;
}

export function normalizeEditorPreviewSearchState(value) {
  const query = typeof value?.query === "string" ? value.query : "";
  const activeMatchIndex = Number.parseInt(String(value?.activeMatchIndex ?? ""), 10);
  const totalMatchCount = Number.parseInt(String(value?.totalMatchCount ?? ""), 10);
  return {
    query,
    activeMatchIndex: Number.isInteger(activeMatchIndex) && activeMatchIndex >= 0 ? activeMatchIndex : 0,
    totalMatchCount: Number.isInteger(totalMatchCount) && totalMatchCount >= 0 ? totalMatchCount : 0,
  };
}

export function selectedEditorPreviewLanguageCode(chapterState) {
  const languages = Array.isArray(chapterState?.languages) ? chapterState.languages : [];
  const codes = new Set(languages.map((language) => language?.code).filter(Boolean));
  // Preview is read-only display/copy, so it intentionally allows selecting any
  // chapter language, including the source language. Do not route this through
  // normalizeLanguageSelections, which correctly rejects source == target for
  // translate-mode editing.
  const previewCode = String(chapterState?.previewLanguageCode ?? "").trim();
  if (previewCode && (codes.size === 0 || codes.has(previewCode))) {
    return previewCode;
  }

  const targetCode = String(chapterState?.selectedTargetLanguageCode ?? "").trim();
  if (targetCode && (codes.size === 0 || codes.has(targetCode))) {
    return targetCode;
  }

  const sourceCode = String(chapterState?.selectedSourceLanguageCode ?? "").trim();
  if (sourceCode && (codes.size === 0 || codes.has(sourceCode))) {
    return sourceCode;
  }

  return languages[0]?.code ?? null;
}

function previewSearchQuery(searchState) {
  return String(normalizeEditorPreviewSearchState(searchState).query ?? "").trim();
}

function previewTextValue(value) {
  return typeof value === "string" ? value : String(value ?? "");
}

function previewImageCaptionValue(row, languageCode) {
  return previewTextValue(row?.imageCaptions?.[languageCode]);
}

function previewFieldValue(row, languageCode) {
  return previewTextValue(row?.fields?.[languageCode]);
}

function previewFootnoteValue(row, languageCode) {
  return normalizeEditorFootnotes(row?.footnotes?.[languageCode]);
}

export function buildEditorPreviewDocument(rows, languageCode) {
  if (!languageCode) {
    return [];
  }

  return (Array.isArray(rows) ? rows : []).flatMap((row) => {
    if (!row || row.lifecycleState === "deleted") {
      return [];
    }

    const text = previewFieldValue(row, languageCode);
    const footnotes = previewFootnoteValue(row, languageCode);
    const image = normalizeEditorFieldImage(row?.images?.[languageCode]);
    const caption = previewImageCaptionValue(row, languageCode);
    const textStyle = normalizeEditorRowTextStyle(row?.textStyle);
    const blocks = [];

    if (text.trim()) {
      blocks.push({
        kind: "text",
        rowId: row.rowId ?? "",
        languageCode,
        textStyle,
        text,
        footnotes,
      });
    }

    if (!text.trim() && footnotes.length > 0) {
      blocks.push({
        kind: "text",
        rowId: row.rowId ?? "",
        languageCode,
        textStyle,
        text: "",
        footnotes,
      });
    }

    if (image) {
      blocks.push({
        kind: "image",
        rowId: row.rowId ?? "",
        languageCode,
        image,
        caption,
      });
    }

    return blocks;
  });
}

function countMatchesInText(text, searchQuery) {
  const normalizedQuery = String(searchQuery ?? "").trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return 0;
  }

  const haystack = extractInlineMarkupVisibleText(previewTextValue(text)).toLocaleLowerCase();
  if (!haystack) {
    return 0;
  }

  let total = 0;
  let fromIndex = 0;
  while (fromIndex <= haystack.length - normalizedQuery.length) {
    const nextIndex = haystack.indexOf(normalizedQuery, fromIndex);
    if (nextIndex < 0) {
      break;
    }

    total += 1;
    fromIndex = nextIndex + normalizedQuery.length;
  }

  return total;
}

function countPreviewSearchMatchesForBlock(block, searchQuery) {
  if (!block || !searchQuery) {
    return 0;
  }

  if (block.kind === "image") {
    return countMatchesInText(block.caption, searchQuery);
  }

  const footnoteMatches = normalizeEditorFootnotes(block.footnotes)
    .reduce((total, entry) => total + countMatchesInText(entry.text, searchQuery), 0);
  return countMatchesInText(block.text, searchQuery) + footnoteMatches;
}

export function countEditorPreviewSearchMatches(blocks, searchQuery) {
  const normalizedQuery = String(searchQuery ?? "").trim();
  if (!normalizedQuery) {
    return 0;
  }

  return (Array.isArray(blocks) ? blocks : [])
    .reduce((total, block) => total + countPreviewSearchMatchesForBlock(block, normalizedQuery), 0);
}

export function normalizeEditorPreviewSearchForDocument(blocks, searchState) {
  const normalizedState = normalizeEditorPreviewSearchState(searchState);
  const query = previewSearchQuery(normalizedState);
  if (!query) {
    return {
      query: "",
      activeMatchIndex: 0,
      totalMatchCount: 0,
    };
  }

  const totalMatchCount = countEditorPreviewSearchMatches(blocks, query);
  return {
    query,
    activeMatchIndex:
      totalMatchCount > 0
        ? Math.min(normalizedState.activeMatchIndex, totalMatchCount - 1)
        : 0,
    totalMatchCount,
  };
}

export function stepEditorPreviewSearchState(blocks, searchState, direction = "next") {
  const normalizedState = normalizeEditorPreviewSearchForDocument(blocks, searchState);
  if (normalizedState.totalMatchCount <= 0) {
    return normalizedState;
  }

  const delta = direction === "previous" ? -1 : 1;
  return {
    ...normalizedState,
    activeMatchIndex:
      (normalizedState.activeMatchIndex + delta + normalizedState.totalMatchCount)
      % normalizedState.totalMatchCount,
  };
}

function renderPreviewPlainText(text) {
  return renderSanitizedInlineMarkupHtml(previewTextValue(text)).replaceAll("\n", "<br>");
}

function renderPreviewHighlightedText(text, searchState, matchCounter, languageCode = "") {
  const normalizedState = normalizeEditorPreviewSearchState(searchState);
  const query = previewSearchQuery(normalizedState);
  if (!query) {
    return renderPreviewPlainText(text);
  }

  const result = renderSanitizedInlineMarkupWithHighlights(
    previewTextValue(text),
    query,
    languageCode,
    {
      activeMatchIndex: normalizedState.activeMatchIndex,
      markRenderer(segmentHtml, range) {
        const matchIndex = matchCounter.current;
        matchCounter.current += 1;
        const isActive = matchIndex === normalizedState.activeMatchIndex;
        return `<mark class="translate-preview__search-match${isActive ? " is-active" : ""}" data-preview-search-match data-preview-search-match-index="${escapeHtml(String(matchIndex))}">${segmentHtml}</mark>`;
      },
    },
  );

  return result.html;
}

function previewTextTagForStyle(textStyle) {
  switch (normalizeEditorRowTextStyle(textStyle)) {
    case EDITOR_ROW_TEXT_STYLE_HEADING1:
      return "h1";
    case EDITOR_ROW_TEXT_STYLE_HEADING2:
      return "h2";
    case EDITOR_ROW_TEXT_STYLE_QUOTE:
      return "blockquote";
    default:
      return "p";
  }
}

function previewTextVariantForStyle(textStyle) {
  switch (normalizeEditorRowTextStyle(textStyle)) {
    case EDITOR_ROW_TEXT_STYLE_HEADING1:
      return "heading1";
    case EDITOR_ROW_TEXT_STYLE_HEADING2:
      return "heading2";
    case EDITOR_ROW_TEXT_STYLE_QUOTE:
      return "quote";
    case EDITOR_ROW_TEXT_STYLE_INDENTED:
      return "indented";
    case EDITOR_ROW_TEXT_STYLE_CENTERED:
      return "centered";
    default:
      return "paragraph";
  }
}

function stableFootnoteId(block, noteNumber) {
  const rowPart = String(block?.rowId ?? "row")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "row";
  return `${rowPart}-${noteNumber}`;
}

function fallbackWordPressFootnoteUuid(block, noteNumber) {
  const source = `${String(block?.rowId ?? "row")}:${String(block?.languageCode ?? "")}:${noteNumber}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, "0");
  return `${hex}-${hex.slice(0, 4)}-4${hex.slice(1, 4)}-8${hex.slice(4, 7)}-${hex}${String(noteNumber).padStart(4, "0")}`;
}

function createWordPressFootnoteId(block, noteNumber) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return fallbackWordPressFootnoteUuid(block, noteNumber);
}

function buildPreviewSearchRanges(visibleText, searchState, matchCounter, languageCode = "") {
  const normalizedState = normalizeEditorPreviewSearchState(searchState);
  const query = previewSearchQuery(normalizedState);
  if (!query) {
    return [];
  }

  const sourceText = String(visibleText ?? "");
  const normalizeSearchCase = (value) => {
    const text = String(value ?? "");
    if (!text) {
      return "";
    }

    try {
      return text.toLocaleLowerCase(languageCode || undefined);
    } catch {
      return text.toLowerCase();
    }
  };
  const haystack = normalizeSearchCase(sourceText);
  const needle = normalizeSearchCase(query);
  const ranges = [];
  let fromIndex = 0;
  while (needle && fromIndex <= haystack.length - needle.length) {
    const start = haystack.indexOf(needle, fromIndex);
    if (start < 0) {
      break;
    }

    const matchIndex = matchCounter.current;
    matchCounter.current += 1;
    ranges.push({
      start,
      end: start + needle.length,
      priority: 10,
      markRenderer(segmentHtml) {
        const isActive = matchIndex === normalizedState.activeMatchIndex;
        return `<mark class="translate-preview__search-match${isActive ? " is-active" : ""}" data-preview-search-match data-preview-search-match-index="${escapeHtml(String(matchIndex))}">${segmentHtml}</mark>`;
      },
    });
    fromIndex = start + needle.length;
  }

  return ranges;
}

function collectEscapedLiteralFootnoteMarkerRanges(visibleText) {
  const source = String(visibleText ?? "");
  const ranges = [];
  let sourceIndex = 0;
  let displayIndex = 0;

  while (sourceIndex < source.length) {
    const escapedMatch = /^\\\[(\d+)\\?\]/.exec(source.slice(sourceIndex));
    if (escapedMatch) {
      const markerTextLength = escapedMatch[1].length + 2;
      ranges.push({
        start: displayIndex,
        end: displayIndex + markerTextLength,
      });
      displayIndex += markerTextLength;
      sourceIndex += escapedMatch[0].length;
      continue;
    }

    displayIndex += 1;
    sourceIndex += 1;
  }

  return ranges;
}

function isInsideAnyRange(range, ranges) {
  return ranges.some((candidate) => range.start >= candidate.start && range.end <= candidate.end);
}

function renderTextWithWordPressFootnoteRefs(block, footnoteState, options = {}) {
  const text = previewTextValue(block?.text);
  const footnotes = normalizeEditorFootnotes(block?.footnotes);
  const parsed = parseInlineMarkup(text);
  const renderText = unescapeLiteralFootnoteMarkers(text);
  const renderParsed = parseInlineMarkup(renderText);
  const visibleText = renderParsed.visibleText;
  const escapedLiteralMarkerRanges = collectEscapedLiteralFootnoteMarkerRanges(parsed.visibleText);
  const ranges = options.serialize
    ? []
    : buildPreviewSearchRanges(
      visibleText,
      options.searchState,
      options.matchCounter ?? { current: 0 },
      block?.languageCode ?? "",
    );

  if (footnotes.length === 0) {
    return options.serialize
      ? serializePreviewText(text)
      : renderSanitizedInlineMarkupWithRanges(renderText, ranges).replaceAll("\n", "<br>");
  }

  const footnoteByMarker = new Map(footnotes.map((entry) => [entry.marker, entry]));
  const usedMarkers = new Set();
  const markers = parseUnescapedFootnoteMarkers(visibleText)
    .filter((marker) => !isInsideAnyRange(
      { start: marker.index, end: marker.endIndex },
      escapedLiteralMarkerRanges,
    ));
  const appendedRefs = [];

  const appendReference = (entry) => {
    usedMarkers.add(entry.marker);
    const number = footnoteState.items.length + 1;
    const id = options.serialize
      ? createWordPressFootnoteId(block, number)
      : stableFootnoteId(block, number);
    footnoteState.items.push({
      id,
      number,
      rowId: block?.rowId ?? "",
      languageCode: block?.languageCode ?? "",
      text: entry.text,
    });
    return options.serialize
      ? `<sup data-fn="${escapeHtml(id)}" class="fn"><a id="${escapeHtml(id)}-link" href="#${escapeHtml(id)}">${number}</a></sup>`
      : `<sup class="translate-preview__footnote-ref fn" data-fn="${escapeHtml(entry.text)}"><a href="#fn-${escapeHtml(id)}" id="fnref-${escapeHtml(id)}" aria-describedby="footnote-label">${number}</a></sup>`;
  };

  for (const marker of markers) {
    const entry = footnoteByMarker.get(marker.marker);
    if (entry && !usedMarkers.has(marker.marker)) {
      const referenceHtml = appendReference(entry);
      ranges.push({
        start: marker.index,
        end: marker.endIndex,
        priority: 5,
        markRenderer() {
          return referenceHtml;
        },
      });
    }
  }

  for (const entry of [...footnotes].sort((left, right) => left.marker - right.marker)) {
    if (usedMarkers.has(entry.marker)) {
      continue;
    }
    appendedRefs.push(appendReference(entry));
  }

  const html = options.serialize
    ? renderSanitizedInlineMarkupWithRanges(renderText, ranges).replaceAll("\n", "<br>")
    : renderSanitizedInlineMarkupWithRanges(renderText, ranges).replaceAll("\n", "<br>");
  const separator = html && appendedRefs.length > 0 && !/\s$/.test(visibleText) ? " " : "";
  return `${html}${separator}${appendedRefs.join(" ")}`;
}

function renderWordPressFootnotesList(footnoteState, renderSegment, options = {}) {
  if (!Array.isArray(footnoteState?.items) || footnoteState.items.length === 0) {
    return "";
  }

  const items = footnoteState.items.map((item) => {
    const backLink = options.serialize
      ? `<a href="#fnref-${escapeHtml(item.id)}" aria-label="Jump to footnote reference ${escapeHtml(item.number)}">&#8617;</a>`
      : `<a class="translate-preview__footnote-backlink" href="#fnref-${escapeHtml(item.id)}" aria-label="Jump to footnote reference ${escapeHtml(item.number)}">&#8617;</a>`;
    return `<li id="fn-${escapeHtml(item.id)}">${renderSegment(item.text, item.languageCode)} ${backLink}</li>`;
  }).join("");

  return `<ol class="wp-block-footnotes">${items}</ol>`;
}

export function renderEditorPreviewDocumentHtml(blocks, options = {}) {
  const searchState = normalizeEditorPreviewSearchForDocument(blocks, options.searchState);
  const resolveImageSrc =
    typeof options.resolveImageSrc === "function"
      ? options.resolveImageSrc
      : (() => "");
  const matchCounter = { current: 0 };
  const footnoteState = { items: [] };
  const html = (Array.isArray(blocks) ? blocks : [])
    .map((block) => {
      if (block?.kind === "image") {
        const imageSrc = resolveImageSrc(block.image);
        if (!imageSrc) {
          return "";
        }

        const caption = String(block.caption ?? "").trim();
        const captionHtml = caption
          ? `<figcaption class="translate-preview__image-caption" lang="${escapeHtml(block.languageCode ?? "")}">${renderPreviewHighlightedText(block.caption, searchState, matchCounter, block.languageCode)}</figcaption>`
          : "";
        return `<figure class="translate-preview__image-block" data-preview-block="image" data-row-id="${escapeHtml(block.rowId ?? "")}"><img class="translate-preview__image" src="${escapeHtml(imageSrc)}" alt="" loading="eager" />${captionHtml}</figure>`;
      }

      if (block?.kind !== "text") {
        return "";
      }

      const tagName = previewTextTagForStyle(block.textStyle);
      const variant = previewTextVariantForStyle(block.textStyle);
      const textHtml = renderTextWithWordPressFootnoteRefs(
        block,
        footnoteState,
        { searchState, matchCounter },
      );
      return `<${tagName} class="translate-preview__block translate-preview__block--${variant}" data-preview-block="${escapeHtml(variant)}" data-row-id="${escapeHtml(block.rowId ?? "")}" lang="${escapeHtml(block.languageCode ?? "")}">${textHtml}</${tagName}>`;
    })
    .filter(Boolean)
    .join("");
  const footnotesHtml = renderWordPressFootnotesList(
    footnoteState,
    (text, languageCode) => renderPreviewHighlightedText(text, searchState, matchCounter, languageCode),
  );

  return {
    html: `${html}${footnotesHtml}`,
    searchState,
  };
}

function serializePreviewText(text) {
  return renderSanitizedInlineMarkupHtml(unescapeLiteralFootnoteMarkers(text)).replaceAll("\n", "<br>");
}

function wrapSerializedWordPressBlock(blockName, html, attributes = null) {
  const serializedAttributes = attributes ? ` ${JSON.stringify(attributes)}` : "";
  return [
    `<!-- wp:${blockName}${serializedAttributes} -->`,
    html,
    `<!-- /wp:${blockName} -->`,
  ].join("\n");
}

function serializePreviewImageHtml(block) {
  const exportSrc =
    block?.image?.kind === "url"
      ? block.image.url ?? ""
      : block?.image?.path ?? "";
  if (!exportSrc) {
    return "";
  }

  const caption = String(block.caption ?? "").trim();
  const figureHtml = [
    '<figure class="wp-block-image">',
    `<img src="${escapeHtml(exportSrc)}" alt="" />`,
    caption
      ? `<figcaption>${serializePreviewText(block.caption)}</figcaption>`
      : "",
    "</figure>",
  ].join("");
  return wrapSerializedWordPressBlock("image", figureHtml);
}

function serializePreviewTextBlockHtml(block, footnoteState) {
  const textHtml = renderTextWithWordPressFootnoteRefs(
    block,
    footnoteState,
    { serialize: true },
  );
  const normalizedStyle = normalizeEditorRowTextStyle(block?.textStyle);
  if (normalizedStyle === EDITOR_ROW_TEXT_STYLE_HEADING1) {
    return {
      blockName: "heading",
      attributes: { level: 1 },
      html: `<h1>${textHtml}</h1>`,
    };
  }
  if (normalizedStyle === EDITOR_ROW_TEXT_STYLE_HEADING2) {
    return {
      blockName: "heading",
      html: `<h2>${textHtml}</h2>`,
    };
  }
  if (normalizedStyle === EDITOR_ROW_TEXT_STYLE_QUOTE) {
    return {
      blockName: "quote",
      html: `<blockquote class="wp-block-quote"><p>${textHtml}</p></blockquote>`,
    };
  }
  if (normalizedStyle === EDITOR_ROW_TEXT_STYLE_INDENTED) {
    return {
      blockName: "paragraph",
      html: `<p style="padding-left: 2em;">${textHtml}</p>`,
    };
  }
  if (normalizedStyle === EDITOR_ROW_TEXT_STYLE_CENTERED) {
    return {
      blockName: "paragraph",
      attributes: { align: "center" },
      html: `<p class="has-text-align-center">${textHtml}</p>`,
    };
  }

  return {
    blockName: "paragraph",
    html: `<p>${textHtml}</p>`,
  };
}

function serializePreviewTextBlock(block, footnoteState) {
  const serializedBlock = serializePreviewTextBlockHtml(block, footnoteState);
  return wrapSerializedWordPressBlock(
    serializedBlock.blockName,
    serializedBlock.html,
    serializedBlock.attributes,
  );
}

export function serializeEditorPreviewHtml(blocks) {
  const footnoteState = { items: [] };
  const bodyHtml = (Array.isArray(blocks) ? blocks : [])
    .map((block) => {
      if (block?.kind === "image") {
        return serializePreviewImageHtml(block);
      }

      return serializePreviewTextBlock(block, footnoteState);
    })
    .filter(Boolean)
    .join("\n");
  const footnotesHtml = footnoteState.items.length > 0 ? "<!-- wp:footnotes /-->" : "";

  return ["<meta charset='utf-8'>", bodyHtml, footnotesHtml].filter(Boolean).join("\n\n");
}
