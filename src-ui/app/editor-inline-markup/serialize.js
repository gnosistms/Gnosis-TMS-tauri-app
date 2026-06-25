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

function serializeElementAttributes(node) {
  const href = node?.tag === "a" && typeof node?.attributes?.href === "string"
    ? node.attributes.href
    : "";
  return href ? ` href="${escapeHtml(href)}"` : "";
}

function renderInlineSeparatorHtml(className = "translation-language-panel__inline-separator") {
  return `<span class="${className}" role="separator" aria-orientation="horizontal"></span>`;
}

function serializeSeparatorNode(options = {}) {
  return options.separatorMode === "display"
    ? renderInlineSeparatorHtml(options.separatorClassName)
    : "<hr>";
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

      if (node.tag === "hr") {
        return " --- ";
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

      if (node.tag === "hr") {
        return renderInlineSeparatorHtml("history-inline-separator");
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

      return `<${node.tag}${serializeElementAttributes(node)}>${renderNodesForHistoryHtml(node.children)}</${node.tag}>`;
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

      if (node.tag === "hr") {
        return allowedTags.has(node.tag) ? "<hr>" : escapeHtml("<hr>");
      }

      if (allowedTags.has(node.tag)) {
        return `<${node.tag}${serializeElementAttributes(node)}>${serializeNodesWithAllowedTags(source, node.children, allowedTags)}</${node.tag}>`;
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

      if (node.tag === "hr") {
        return "";
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

function splitNodesOnInlineSeparators(nodes) {
  const parts = [];
  let currentNodes = [];

  function pushTextPart() {
    parts.push({
      kind: "text",
      nodes: currentNodes,
    });
    currentNodes = [];
  }

  function appendNodes(nextNodes) {
    for (const node of Array.isArray(nextNodes) ? nextNodes : []) {
      if (!node) {
        continue;
      }

      if (node.type === "element" && node.tag === "hr") {
        pushTextPart();
        parts.push({ kind: "separator" });
        continue;
      }

      if (node.type !== "element") {
        currentNodes.push(node);
        continue;
      }

      const childParts = splitNodesOnInlineSeparators(node.children);
      if (childParts.length === 1 && childParts[0]?.kind === "text") {
        currentNodes.push({
          ...node,
          children: childParts[0].nodes,
        });
        continue;
      }

      for (const childPart of childParts) {
        if (childPart.kind === "separator") {
          pushTextPart();
          parts.push({ kind: "separator" });
          continue;
        }

        currentNodes.push({
          ...node,
          children: childPart.nodes,
        });
      }
    }
  }

  appendNodes(nodes);
  pushTextPart();

  const compactParts = [];
  for (const part of parts) {
    if (
      part.kind === "text"
      && compactParts.length > 0
      && compactParts[compactParts.length - 1]?.kind === "text"
    ) {
      compactParts[compactParts.length - 1].nodes.push(...part.nodes);
      continue;
    }
    compactParts.push(part);
  }
  return compactParts;
}

function serializeNodes(nodes, highlightRanges = [], markRenderer = null, options = {}) {
  return (Array.isArray(nodes) ? nodes : [])
    .map((node) => {
      if (!node) {
        return "";
      }

      if (node.type === "text") {
        return serializeTextWithHighlights(node.text, node.visibleStart, highlightRanges, markRenderer);
      }

      if (node.tag === "hr") {
        return serializeSeparatorNode(options);
      }

      return `<${node.tag}${serializeElementAttributes(node)}>${serializeNodes(node.children, highlightRanges, markRenderer, options)}</${node.tag}>`;
    })
    .join("");
}

function serializeNodesAsInlineMarkupSource(nodes) {
  return (Array.isArray(nodes) ? nodes : [])
    .map((node) => {
      if (!node) {
        return "";
      }

      if (node.type === "text") {
        return node.text;
      }

      if (node.tag === "hr") {
        return "<hr>";
      }

      return `<${node.tag}${serializeElementAttributes(node)}>${serializeNodesAsInlineMarkupSource(node.children)}</${node.tag}>`;
    })
    .join("");
}

export function splitInlineMarkupTextBySeparators(value) {
  const parsed = parseInlineMarkup(value);
  return splitNodesOnInlineSeparators(parsed.nodes)
    .map((part) => part.kind === "separator"
      ? { kind: "separator" }
      : {
        kind: "text",
        text: serializeNodesAsInlineMarkupSource(part.nodes),
      });
}

export function extractInlineMarkupVisibleText(value) {
  return parseInlineMarkup(value).visibleText;
}

// True when a link's visible text is already a URL, so appending the destination
// in parentheses would be redundant. Matches a bare http(s) URL with no internal
// whitespace, or visible text equal to the href (ignoring case and a trailing slash).
function linkVisibleTextIsUrl(text, href) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) {
    return false;
  }
  if (/^https?:\/\/\S+$/i.test(trimmed)) {
    return true;
  }
  const normalize = (value) => String(value ?? "").trim().replace(/\/+$/, "").toLowerCase();
  return normalize(trimmed) === normalize(href);
}

function flattenNodesToVisibleTextWithLinkUrls(nodes) {
  return (Array.isArray(nodes) ? nodes : [])
    .map((node) => {
      if (!node) {
        return "";
      }
      if (node.type === "text") {
        return node.text;
      }
      const inner = flattenNodesToVisibleTextWithLinkUrls(node.children);
      if (node.tag === "a") {
        const href = typeof node.attributes?.href === "string" ? node.attributes.href : "";
        if (href && !linkVisibleTextIsUrl(inner, href)) {
          return `${inner} (${href})`;
        }
      }
      return inner;
    })
    .join("");
}

// Like extractInlineMarkupVisibleText, but appends each link's destination as plain
// text " (url)" after its visible text, unless that text already is a URL. Used for
// footnotes in print-oriented exports where a hyperlink cannot be clicked.
export function extractInlineMarkupVisibleTextWithLinkUrls(value) {
  return flattenNodesToVisibleTextWithLinkUrls(parseInlineMarkup(value).nodes);
}

export function extractInlineMarkupBaseText(value) {
  return flattenNodesToBaseText(parseInlineMarkup(value).nodes);
}

export function renderSanitizedInlineMarkupHtml(value) {
  const parsed = parseInlineMarkup(value);
  return serializeNodes(parsed.nodes, [], null, { separatorMode: "display" });
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
  renderInlineSeparatorHtml,
  serializeNodesWithAllowedTags,
  serializeNodesForRubyNotation,
  serializeNodes,
};
