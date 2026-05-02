import { parseInlineMarkup, collectTextSegments } from "./parser.js";
import {
  escapeHtml,
  serializeNodes,
  renderSanitizedInlineMarkupHtml,
} from "./serialize.js";
import { normalizeVisibleHighlightRanges } from "./ranges.js";

function matchRangesForQuery(visibleText, query, languageCode = "", options = {}) {
  const sourceText = String(visibleText ?? "");
  const normalizedQuery = String(query ?? "").trim();
  const caseSensitive = options?.caseSensitive === true;
  if (!sourceText || !normalizedQuery) {
    return [];
  }

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

  const haystack = caseSensitive ? sourceText : normalizeSearchCase(sourceText);
  const needle = caseSensitive ? normalizedQuery : normalizeSearchCase(normalizedQuery);
  if (!needle) {
    return [];
  }

  const matches = [];
  let fromIndex = 0;
  while (fromIndex <= haystack.length - needle.length) {
    const start = haystack.indexOf(needle, fromIndex);
    if (start < 0) {
      break;
    }

    const end = start + needle.length;
    matches.push({
      start,
      end,
      text: sourceText.slice(start, end),
    });
    fromIndex = end;
  }

  return matches;
}

export function renderSanitizedInlineMarkupWithRanges(value, ranges = [], markRenderer = null) {
  const parsed = parseInlineMarkup(value);
  return serializeNodes(
    parsed.nodes,
    normalizeVisibleHighlightRanges(ranges, parsed.visibleLength),
    markRenderer,
  );
}

function readMarkupAttributeValue(attributes, name) {
  const pattern = new RegExp(`\\b${String(name).replace(/[.*+?^${}()|[\]\\\\]/g, "\\$&")}="([^"]*)"`);
  const match = pattern.exec(String(attributes ?? ""));
  return match ? match[1] : "";
}

function parseGlossaryHighlightRanges(highlightHtml) {
  const source = typeof highlightHtml === "string" ? highlightHtml : "";
  const ranges = [];
  const markPattern = /<mark\b([^>]*)>[\s\S]*?<\/mark>/g;
  let match = markPattern.exec(source);

  while (match) {
    const attributes = match[1] ?? "";
    const start = Number.parseInt(readMarkupAttributeValue(attributes, "data-text-start"), 10);
    const end = Number.parseInt(readMarkupAttributeValue(attributes, "data-text-end"), 10);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      ranges.push({
        start,
        end,
        classValue: readMarkupAttributeValue(attributes, "class"),
        tooltipValue: readMarkupAttributeValue(attributes, "data-editor-glossary-tooltip"),
        tooltipPayloadValue: readMarkupAttributeValue(
          attributes,
          "data-editor-glossary-tooltip-payload",
        ),
      });
    }

    match = markPattern.exec(source);
  }

  return ranges;
}

function renderGlossaryMark(segmentHtml, range) {
  const classValue = range?.classValue || "glossary-match translation-language-panel__glossary-mark";
  let attributes =
    `class="${classValue}" data-editor-glossary-mark`
    + ` data-text-start="${range?.start ?? 0}"`
    + ` data-text-end="${range?.end ?? 0}"`;
  if (range?.tooltipValue) {
    attributes += ` data-editor-glossary-tooltip="${range.tooltipValue}"`;
  }
  if (range?.tooltipPayloadValue) {
    attributes += ` data-editor-glossary-tooltip-payload="${range.tooltipPayloadValue}"`;
  }

  return `<mark ${attributes}>${segmentHtml}</mark>`;
}

function renderSearchMark(segmentHtml) {
  return `<mark class="translation-language-panel__search-match">${segmentHtml}</mark>`;
}

export function renderSanitizedInlineMarkupWithGlossaryHighlightHtml(value, highlightHtml) {
  const ranges = parseGlossaryHighlightRanges(highlightHtml);
  if (ranges.length === 0) {
    return renderSanitizedInlineMarkupHtml(value);
  }

  return renderSanitizedInlineMarkupWithRanges(
    value,
    ranges.map((range) => ({
      ...range,
      priority: 20,
      markRenderer: renderGlossaryMark,
    })),
  );
}

export function renderSanitizedInlineMarkupWithEditorHighlightState(
  value,
  {
    glossaryHighlightHtml = "",
    searchRanges = [],
  } = {},
) {
  const ranges = [
    ...(Array.isArray(searchRanges) ? searchRanges : []).map((range) => ({
      ...range,
      priority: 10,
      markRenderer: renderSearchMark,
    })),
    ...parseGlossaryHighlightRanges(glossaryHighlightHtml).map((range) => ({
      ...range,
      priority: 20,
      markRenderer: renderGlossaryMark,
    })),
  ];
  if (ranges.length === 0) {
    return renderSanitizedInlineMarkupHtml(value);
  }

  return renderSanitizedInlineMarkupWithRanges(value, ranges);
}

export function renderSanitizedInlineMarkupWithHighlights(value, query, languageCode = "", options = {}) {
  const parsed = parseInlineMarkup(value);
  const matches = matchRangesForQuery(parsed.visibleText, query, languageCode, options);
  const html = serializeNodes(
    parsed.nodes,
    matches.map((match, index) => ({
      ...match,
      index,
      isActive: index === (Number.parseInt(options?.activeMatchIndex ?? "", 10) || 0),
    })),
    options.markRenderer,
  );

  return {
    html,
    totalMatchCount: matches.length,
  };
}

export function buildInlineMarkupSearchHighlightMarkup(value, query, languageCode = "", options = {}) {
  const parsed = parseInlineMarkup(value);
  const matches = matchRangesForQuery(parsed.visibleText, query, languageCode, options);
  if (matches.length === 0) {
    return {
      kind: "search",
      html: "",
      hasMatches: false,
      ranges: [],
    };
  }

  const rawRanges = [];
  for (const match of matches) {
    for (const segment of collectTextSegments(parsed.nodes)) {
      if (match.end <= segment.visibleStart || match.start >= segment.visibleEnd) {
        continue;
      }

      const overlapStart = Math.max(match.start, segment.visibleStart);
      const overlapEnd = Math.min(match.end, segment.visibleEnd);
      if (overlapEnd <= overlapStart) {
        continue;
      }

      rawRanges.push({
        start: segment.rawStart + (overlapStart - segment.visibleStart),
        end: segment.rawStart + (overlapEnd - segment.visibleStart),
      });
    }
  }

  rawRanges.sort((left, right) => left.start - right.start);
  const mergedRanges = [];
  for (const range of rawRanges) {
    const previous = mergedRanges[mergedRanges.length - 1] ?? null;
    if (!previous || range.start > previous.end) {
      mergedRanges.push({ ...range });
      continue;
    }

    previous.end = Math.max(previous.end, range.end);
  }

  let cursor = 0;
  let html = "";
  for (const range of mergedRanges) {
    if (range.start > cursor) {
      html += escapeHtml(parsed.source.slice(cursor, range.start));
    }

    html += `<mark class="translation-language-panel__search-match">${escapeHtml(parsed.source.slice(range.start, range.end))}</mark>`;
    cursor = range.end;
  }

  if (cursor < parsed.source.length) {
    html += escapeHtml(parsed.source.slice(cursor));
  }

  return {
    kind: "search",
    html,
    hasMatches: true,
    ranges: matches.map((match) => ({
      start: match.start,
      end: match.end,
      text: match.text,
    })),
  };
}

export {
  matchRangesForQuery,
};
