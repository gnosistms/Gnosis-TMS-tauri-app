import {
  SUPPORTED_TAGS,
  parseInlineMarkup,
  splitRubyNodeChildren,
} from "./parser.js";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function flattenNodesToBaseText(nodes, insideRubyAnnotation = false) {
  return (Array.isArray(nodes) ? nodes : [])
    .map((node) => {
      if (!node) {
        return "";
      }

      if (node.type === "text") {
        return insideRubyAnnotation ? "" : node.text;
      }

      return flattenNodesToBaseText(
        node.children,
        insideRubyAnnotation || node.tag === "rt",
      );
    })
    .join("");
}

function flattenNodesToHistoryText(nodes) {
  return (Array.isArray(nodes) ? nodes : [])
    .map((node) => {
      if (!node) {
        return "";
      }

      if (node.type === "text") {
        return node.text;
      }

      if (node.tag === "ruby") {
        const { baseChildren, annotationChildren } = splitRubyNodeChildren(node.children);
        const baseText = flattenNodesToHistoryText(baseChildren);
        const annotationText = flattenNodesToHistoryText(annotationChildren);
        return annotationText ? `${baseText} ❬${annotationText}❭` : baseText;
      }

      if (node.tag === "rt") {
        const annotationText = flattenNodesToHistoryText(node.children);
        return annotationText ? `❬${annotationText}❭` : "";
      }

      return flattenNodesToHistoryText(node.children);
    })
    .join("");
}

function renderNodesForHistoryHtml(nodes) {
  return (Array.isArray(nodes) ? nodes : [])
    .map((node) => {
      if (!node) {
        return "";
      }

      if (node.type === "text") {
        return escapeHtml(node.text);
      }

      if (node.tag === "ruby") {
        const { baseChildren, annotationChildren } = splitRubyNodeChildren(node.children);
        const baseHtml = renderNodesForHistoryHtml(baseChildren);
        const annotationText = flattenNodesToHistoryText(annotationChildren);
        return annotationText
          ? `${baseHtml}<span class="history-inline-ruby-annotation"> ❬${escapeHtml(annotationText)}❭</span>`
          : baseHtml;
      }

      if (node.tag === "rt") {
        const annotationText = flattenNodesToHistoryText(node.children);
        return annotationText
          ? `<span class="history-inline-ruby-annotation">❬${escapeHtml(annotationText)}❭</span>`
          : "";
      }

      return `<${node.tag}>${renderNodesForHistoryHtml(node.children)}</${node.tag}>`;
    })
    .join("");
}

function serializeNodesWithAllowedTags(source, nodes, allowedTags) {
  return (Array.isArray(nodes) ? nodes : [])
    .map((node) => {
      if (!node) {
        return "";
      }

      if (node.type === "text") {
        return escapeHtml(node.text);
      }

      if (allowedTags.has(node.tag)) {
        return `<${node.tag}>${serializeNodesWithAllowedTags(source, node.children, allowedTags)}</${node.tag}>`;
      }

      const openingTag = node.openStart >= 0 && node.openEnd >= 0
        ? source.slice(node.openStart, node.openEnd)
        : "";
      const closingTag = node.closeStart >= 0 && node.closeEnd >= 0
        ? source.slice(node.closeStart, node.closeEnd)
        : "";
      return (
        escapeHtml(openingTag)
        + serializeNodesWithAllowedTags(source, node.children, allowedTags)
        + escapeHtml(closingTag)
      );
    })
    .join("");
}

function serializeNodesForRubyNotation(nodes, insideRubyAnnotation = false) {
  return (Array.isArray(nodes) ? nodes : [])
    .map((node) => {
      if (!node) {
        return "";
      }

      if (node.type === "text") {
        return node.text;
      }

      if (node.tag === "ruby") {
        const { baseChildren, annotationChildren } = splitRubyNodeChildren(node.children);
        const baseText = serializeNodesForRubyNotation(baseChildren, false);
        const annotationText = serializeNodesForRubyNotation(annotationChildren, true).trim();
        return annotationText ? `${baseText}[ruby: ${annotationText}]` : baseText;
      }

      if (node.tag === "rt") {
        return serializeNodesForRubyNotation(node.children, true);
      }

      return serializeNodesForRubyNotation(node.children, insideRubyAnnotation);
    })
    .join("");
}

function highlightRangePriority(range) {
  return Number.isFinite(range?.priority) ? Number(range.priority) : 0;
}

function highlightRangeLength(range) {
  return Math.max(0, Number(range?.end ?? 0) - Number(range?.start ?? 0));
}

function sortedActiveHighlightRanges(ranges) {
  return [...(Array.isArray(ranges) ? ranges : [])].sort((left, right) => {
    const priorityDifference = highlightRangePriority(left) - highlightRangePriority(right);
    if (priorityDifference !== 0) {
      return priorityDifference;
    }

    const lengthDifference = highlightRangeLength(right) - highlightRangeLength(left);
    if (lengthDifference !== 0) {
      return lengthDifference;
    }

    if ((left?.start ?? 0) !== (right?.start ?? 0)) {
      return (left?.start ?? 0) - (right?.start ?? 0);
    }

    return (left?.end ?? 0) - (right?.end ?? 0);
  });
}

function renderHighlightedSegment(segmentHtml, activeRanges, defaultMarkRenderer) {
  return sortedActiveHighlightRanges(activeRanges).reduce((html, range) => {
    const renderer =
      typeof range?.markRenderer === "function"
        ? range.markRenderer
        : defaultMarkRenderer;
    return typeof renderer === "function" ? renderer(html, range) : html;
  }, segmentHtml);
}

function serializeTextWithHighlights(text, visibleStart, highlightRanges, markRenderer) {
  const value = String(text ?? "");
  if (!value) {
    return "";
  }

  const ranges = (Array.isArray(highlightRanges) ? highlightRanges : [])
    .filter((range) => range.end > visibleStart && range.start < visibleStart + value.length)
    .map((range) => ({
      ...range,
      start: Math.max(visibleStart, range.start),
      end: Math.min(visibleStart + value.length, range.end),
    }))
    .sort((left, right) => left.start - right.start);

  if (ranges.length === 0) {
    return escapeHtml(value);
  }

  let html = "";
  const localBoundaries = new Set([0, value.length]);

  for (const range of ranges) {
    localBoundaries.add(range.start - visibleStart);
    localBoundaries.add(range.end - visibleStart);
  }

  const sortedBoundaries = [...localBoundaries]
    .filter((boundary) => boundary >= 0 && boundary <= value.length)
    .sort((left, right) => left - right);

  for (let index = 0; index < sortedBoundaries.length - 1; index += 1) {
    const localStart = sortedBoundaries[index];
    const localEnd = sortedBoundaries[index + 1];
    if (localEnd <= localStart) {
      continue;
    }

    const segmentHtml = escapeHtml(value.slice(localStart, localEnd));
    const segmentVisibleStart = visibleStart + localStart;
    const segmentVisibleEnd = visibleStart + localEnd;
    const activeRanges = ranges.filter(
      (range) => range.start < segmentVisibleEnd && range.end > segmentVisibleStart,
    );
    html += activeRanges.length > 0
      ? renderHighlightedSegment(segmentHtml, activeRanges, markRenderer)
      : segmentHtml;
  }

  return html;
}

function serializeNodes(nodes, highlightRanges = [], markRenderer = null) {
  return (Array.isArray(nodes) ? nodes : [])
    .map((node) => {
      if (!node) {
        return "";
      }

      if (node.type === "text") {
        return serializeTextWithHighlights(node.text, node.visibleStart, highlightRanges, markRenderer);
      }

      return `<${node.tag}>${serializeNodes(node.children, highlightRanges, markRenderer)}</${node.tag}>`;
    })
    .join("");
}

export function extractInlineMarkupVisibleText(value) {
  return parseInlineMarkup(value).visibleText;
}

export function extractInlineMarkupBaseText(value) {
  return flattenNodesToBaseText(parseInlineMarkup(value).nodes);
}

export function renderSanitizedInlineMarkupHtml(value) {
  const parsed = parseInlineMarkup(value);
  return serializeNodes(parsed.nodes);
}

export function renderSanitizedInlineMarkupHtmlWithAllowedTags(value, allowedTags = SUPPORTED_TAGS) {
  const parsed = parseInlineMarkup(value);
  const normalizedAllowedTags = new Set(
    Array.isArray(allowedTags) ? allowedTags : Array.from(allowedTags || []),
  );
  return serializeNodesWithAllowedTags(parsed.source, parsed.nodes, normalizedAllowedTags);
}

export function extractInlineMarkupHistoryText(value) {
  return flattenNodesToHistoryText(parseInlineMarkup(value).nodes);
}

export function renderSanitizedInlineMarkupHistoryHtml(value) {
  return renderNodesForHistoryHtml(parseInlineMarkup(value).nodes);
}

export function serializeInlineMarkupRubyNotation(value) {
  return serializeNodesForRubyNotation(parseInlineMarkup(value).nodes);
}

export {
  escapeHtml,
  flattenNodesToBaseText,
  serializeNodesWithAllowedTags,
  serializeNodesForRubyNotation,
  serializeNodes,
};
