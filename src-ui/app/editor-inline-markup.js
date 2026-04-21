const STYLE_TO_TAG = {
  bold: "strong",
  italic: "em",
  underline: "u",
  ruby: "ruby",
  strong: "strong",
  em: "em",
  u: "u",
};

const TAG_TO_STYLE = {
  strong: "bold",
  em: "italic",
  u: "underline",
  ruby: "ruby",
};

const SUPPORTED_TAGS = new Set(["strong", "em", "u", "ruby", "rt"]);
const TAG_ALIASES = {
  b: "strong",
  i: "em",
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizedLanguageCode(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function isChineseLanguageCode(languageCode) {
  return normalizedLanguageCode(languageCode).toLowerCase().startsWith("zh");
}

export function rubyButtonConfig(languageCode) {
  const normalizedCode = normalizedLanguageCode(languageCode).toLowerCase();
  if (normalizedCode === "ja") {
    return {
      label: "振",
      tooltip: "ルビを挿入",
      placeholder: "よみ",
    };
  }

  if (isChineseLanguageCode(normalizedCode)) {
    return {
      label: "注",
      tooltip: "添加读音标注",
      placeholder: "读音",
    };
  }

  if (normalizedCode === "ko") {
    return {
      label: "주",
      tooltip: "발음 표기 추가",
      placeholder: "발음",
    };
  }

  return {
    label: "r",
    tooltip: "Ruby",
    placeholder: "ruby text here",
  };
}

function normalizeInlineStyle(style) {
  const normalized = typeof style === "string" ? style.trim().toLowerCase() : "";
  return STYLE_TO_TAG[normalized] ?? "";
}

function elementNode(tag, children = []) {
  return {
    type: "element",
    tag,
    children,
    openStart: -1,
    openEnd: -1,
    closeStart: -1,
    closeEnd: -1,
    rawStart: -1,
    rawEnd: -1,
    visibleStart: 0,
    visibleEnd: 0,
  };
}

function textNode(text, rawStart, rawEnd, visibleStart) {
  const value = String(text ?? "");
  return {
    type: "text",
    text: value,
    rawStart,
    rawEnd,
    visibleStart,
    visibleEnd: visibleStart + value.length,
  };
}

function cloneNode(node) {
  if (!node || typeof node !== "object") {
    return textNode("", 0, 0, 0);
  }

  if (node.type === "text") {
    return {
      ...node,
    };
  }

  return {
    ...node,
    children: cloneNodes(node.children),
  };
}

function cloneNodes(nodes) {
  return (Array.isArray(nodes) ? nodes : []).map((node) => cloneNode(node));
}

function parseTagToken(rawTag) {
  const match = /^<\s*(\/?)\s*([A-Za-z][A-Za-z0-9]*)\s*>$/.exec(rawTag);
  if (!match) {
    return null;
  }

  const isClosing = match[1] === "/";
  const rawName = match[2].toLowerCase();
  const normalizedName = TAG_ALIASES[rawName] ?? rawName;
  if (!SUPPORTED_TAGS.has(normalizedName)) {
    return null;
  }

  return {
    isClosing,
    tag: normalizedName,
  };
}

function finalizeElement(node, visibleEnd, rawEnd, closeStart = -1, closeEnd = -1) {
  node.visibleEnd = visibleEnd;
  node.rawEnd = rawEnd;
  node.closeStart = closeStart;
  node.closeEnd = closeEnd;
}

function parseInlineMarkup(value) {
  const source = String(value ?? "");
  const root = elementNode("root", []);
  const stack = [root];
  let cursor = 0;
  let visibleCursor = 0;

  function appendText(text, rawStart, rawEnd) {
    if (!text) {
      return;
    }

    stack[stack.length - 1].children.push(textNode(text, rawStart, rawEnd, visibleCursor));
    visibleCursor += text.length;
  }

  while (cursor < source.length) {
    if (source[cursor] !== "<") {
      const nextTagIndex = source.indexOf("<", cursor);
      const nextCursor = nextTagIndex >= 0 ? nextTagIndex : source.length;
      appendText(source.slice(cursor, nextCursor), cursor, nextCursor);
      cursor = nextCursor;
      continue;
    }

    const closingBracketIndex = source.indexOf(">", cursor + 1);
    if (closingBracketIndex < 0) {
      appendText(source.slice(cursor), cursor, source.length);
      cursor = source.length;
      continue;
    }

    const rawTag = source.slice(cursor, closingBracketIndex + 1);
    const token = parseTagToken(rawTag);
    if (!token) {
      appendText(rawTag, cursor, closingBracketIndex + 1);
      cursor = closingBracketIndex + 1;
      continue;
    }

    if (!token.isClosing) {
      const nextNode = elementNode(token.tag, []);
      nextNode.openStart = cursor;
      nextNode.openEnd = closingBracketIndex + 1;
      nextNode.rawStart = cursor;
      nextNode.visibleStart = visibleCursor;
      stack[stack.length - 1].children.push(nextNode);
      stack.push(nextNode);
      cursor = closingBracketIndex + 1;
      continue;
    }

    let matchedIndex = -1;
    for (let index = stack.length - 1; index >= 1; index -= 1) {
      if (stack[index].tag === token.tag) {
        matchedIndex = index;
        break;
      }
    }

    if (matchedIndex < 0) {
      appendText(rawTag, cursor, closingBracketIndex + 1);
      cursor = closingBracketIndex + 1;
      continue;
    }

    while (stack.length - 1 > matchedIndex) {
      finalizeElement(stack.pop(), visibleCursor, cursor);
    }

    const matchedNode = stack.pop();
    finalizeElement(
      matchedNode,
      visibleCursor,
      closingBracketIndex + 1,
      cursor,
      closingBracketIndex + 1,
    );
    cursor = closingBracketIndex + 1;
  }

  while (stack.length > 1) {
    finalizeElement(stack.pop(), visibleCursor, source.length);
  }

  finalizeElement(root, visibleCursor, source.length);
  return {
    source,
    nodes: root.children,
    visibleText: flattenNodesToVisibleText(root.children),
    visibleLength: visibleCursor,
  };
}

function flattenNodesToVisibleText(nodes) {
  return (Array.isArray(nodes) ? nodes : [])
    .map((node) => (node.type === "text" ? node.text : flattenNodesToVisibleText(node.children)))
    .join("");
}

function splitRubyNodeChildren(children) {
  const baseChildren = [];
  const annotationChildren = [];

  for (const child of Array.isArray(children) ? children : []) {
    if (child?.type === "element" && child.tag === "rt") {
      annotationChildren.push(...(Array.isArray(child.children) ? child.children : []));
      continue;
    }

    baseChildren.push(child);
  }

  return {
    baseChildren,
    annotationChildren,
  };
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

function collectTextSegments(nodes, segments = []) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node) {
      continue;
    }

    if (node.type === "text") {
      segments.push(node);
      continue;
    }

    collectTextSegments(node.children, segments);
  }

  return segments;
}

function collectElementNodes(nodes, elements = []) {
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node || node.type !== "element") {
      continue;
    }

    elements.push(node);
    collectElementNodes(node.children, elements);
  }

  return elements;
}

function rawOffsetToVisiblePosition(parsed, rawOffset) {
  const boundedOffset = Math.max(0, Math.min(parsed.source.length, Number.parseInt(rawOffset ?? "", 10) || 0));
  const segments = collectTextSegments(parsed.nodes);
  let visibleCursor = 0;

  for (const segment of segments) {
    if (boundedOffset < segment.rawStart) {
      return visibleCursor;
    }

    if (boundedOffset <= segment.rawEnd) {
      return segment.visibleStart + Math.max(0, Math.min(segment.text.length, boundedOffset - segment.rawStart));
    }

    visibleCursor = segment.visibleEnd;
  }

  return parsed.visibleLength;
}

function isInlineMarkupWordCharacter(character) {
  return typeof character === "string" && /[\p{L}\p{M}\p{N}_]/u.test(character);
}

function collapsedWordVisibleRange(parsed, rawOffset) {
  const visibleText = String(parsed?.visibleText ?? "");
  if (!visibleText) {
    return null;
  }

  const visiblePosition = rawOffsetToVisiblePosition(parsed, rawOffset);
  const nextCharacter = visibleText[visiblePosition] ?? "";
  const anchorIndex = isInlineMarkupWordCharacter(nextCharacter) ? visiblePosition : -1;

  if (anchorIndex < 0) {
    return null;
  }

  let start = anchorIndex;
  let end = anchorIndex + 1;
  while (start > 0 && isInlineMarkupWordCharacter(visibleText[start - 1])) {
    start -= 1;
  }
  while (end < visibleText.length && isInlineMarkupWordCharacter(visibleText[end])) {
    end += 1;
  }

  return { start, end };
}

function visiblePositionToRawOffset(parsed, visiblePosition, bias = "start") {
  const boundedPosition = Math.max(0, Math.min(parsed.visibleLength, Number.parseInt(visiblePosition ?? "", 10) || 0));
  const segments = collectTextSegments(parsed.nodes);
  let previousSegment = null;

  for (const segment of segments) {
    if (boundedPosition < segment.visibleStart) {
      return bias === "end" && previousSegment ? previousSegment.rawEnd : segment.rawStart;
    }

    if (boundedPosition <= segment.visibleEnd) {
      return segment.rawStart + Math.max(0, Math.min(segment.text.length, boundedPosition - segment.visibleStart));
    }

    previousSegment = segment;
  }

  return previousSegment ? previousSegment.rawEnd : parsed.source.length;
}

function selectedVisibleSegments(parsed, selectionStart, selectionEnd) {
  const start = Math.max(0, Math.min(parsed.source.length, Number.parseInt(selectionStart ?? "", 10) || 0));
  const end = Math.max(start, Math.min(parsed.source.length, Number.parseInt(selectionEnd ?? "", 10) || 0));
  const segments = [];

  for (const segment of collectTextSegments(parsed.nodes)) {
    const overlapStart = Math.max(start, segment.rawStart);
    const overlapEnd = Math.min(end, segment.rawEnd);
    if (overlapEnd <= overlapStart) {
      continue;
    }

    segments.push({
      rawStart: overlapStart,
      rawEnd: overlapEnd,
      visibleStart: segment.visibleStart + (overlapStart - segment.rawStart),
      visibleEnd: segment.visibleStart + (overlapEnd - segment.rawStart),
    });
  }

  return segments;
}

function findSmallestElementByPredicate(parsed, tag, predicate) {
  const elements = collectElementNodes(parsed.nodes)
    .filter((node) => node.tag === tag)
    .filter(predicate);

  if (elements.length === 0) {
    return null;
  }

  return elements.sort((left, right) => {
    const leftSpan = left.rawEnd - left.rawStart;
    const rightSpan = right.rawEnd - right.rawStart;
    return leftSpan - rightSpan;
  })[0] ?? null;
}

function findElementContainingCursor(parsed, tag, rawOffset) {
  const cursor = Math.max(0, Math.min(parsed.source.length, Number.parseInt(rawOffset ?? "", 10) || 0));
  return findSmallestElementByPredicate(
    parsed,
    tag,
    (node) => cursor >= node.rawStart && cursor <= node.rawEnd,
  );
}

function findElementContainingSelection(parsed, tag, selectionStart, selectionEnd) {
  const visibleSegments = selectedVisibleSegments(parsed, selectionStart, selectionEnd);
  if (visibleSegments.length === 0) {
    const start = Math.max(0, Math.min(parsed.source.length, Number.parseInt(selectionStart ?? "", 10) || 0));
    const end = Math.max(start, Math.min(parsed.source.length, Number.parseInt(selectionEnd ?? "", 10) || 0));
    return findSmallestElementByPredicate(
      parsed,
      tag,
      (node) => start >= node.rawStart && end <= node.rawEnd,
    );
  }

  return findSmallestElementByPredicate(
    parsed,
    tag,
    (node) =>
      visibleSegments.every((segment) => {
        const contentEnd = node.closeStart >= 0 ? node.closeStart : node.rawEnd;
        return segment.rawStart >= node.openEnd && segment.rawEnd <= contentEnd;
      }),
  );
}

function splitTextByVisibleRange(node, start, end) {
  const overlapStart = Math.max(start, node.visibleStart);
  const overlapEnd = Math.min(end, node.visibleEnd);
  if (overlapEnd <= overlapStart) {
    return {
      before: node.text,
      middle: "",
      after: "",
    };
  }

  const localStart = overlapStart - node.visibleStart;
  const localEnd = overlapEnd - node.visibleStart;
  return {
    before: node.text.slice(0, localStart),
    middle: node.text.slice(localStart, localEnd),
    after: node.text.slice(localEnd),
  };
}

function cloneElementWithChildren(node, children) {
  return {
    ...node,
    children,
  };
}

function materializeStyledSegments(segments, tag) {
  const nextNodes = [];
  let styledBuffer = [];

  function flushStyledBuffer() {
    if (styledBuffer.length === 0) {
      return;
    }

    nextNodes.push(elementNode(tag, styledBuffer));
    styledBuffer = [];
  }

  for (const segment of Array.isArray(segments) ? segments : []) {
    if (!segment?.node) {
      continue;
    }

    if (segment.styled) {
      styledBuffer.push(segment.node);
      continue;
    }

    flushStyledBuffer();
    nextNodes.push(segment.node);
  }

  flushStyledBuffer();
  return nextNodes;
}

function applyStyleSegments(nodes, tag, start, end, underTarget = false) {
  const segments = [];

  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node) {
      continue;
    }

    if (node.type === "text") {
      if (end <= node.visibleStart || start >= node.visibleEnd) {
        segments.push({ styled: underTarget, node: cloneNode(node) });
        continue;
      }

      const split = splitTextByVisibleRange(node, start, end);
      if (split.before) {
        segments.push({ styled: underTarget, node: textNode(split.before, 0, 0, 0) });
      }
      if (split.middle) {
        segments.push({ styled: true, node: textNode(split.middle, 0, 0, 0) });
      }
      if (split.after) {
        segments.push({ styled: underTarget, node: textNode(split.after, 0, 0, 0) });
      }
      continue;
    }

    if (node.tag === "ruby" && tag !== "ruby") {
      if (end <= node.visibleStart || start >= node.visibleEnd) {
        segments.push({ styled: underTarget, node: cloneNode(node) });
        continue;
      }

      segments.push({ styled: true, node: cloneNode(node) });
      continue;
    }

    if (node.tag === tag) {
      if (end <= node.visibleStart || start >= node.visibleEnd) {
        segments.push({ styled: underTarget, node: cloneNode(node) });
        continue;
      }

      const childSegments = applyStyleSegments(node.children, tag, start, end, true);
      segments.push({
        styled: underTarget,
        node: cloneElementWithChildren(node, materializeStyledSegments(childSegments, tag)),
      });
      continue;
    }

    if (end <= node.visibleStart || start >= node.visibleEnd) {
      segments.push({ styled: underTarget, node: cloneNode(node) });
      continue;
    }

    const childSegments = applyStyleSegments(node.children, tag, start, end, underTarget);
    for (const group of groupSegmentsByStyle(childSegments)) {
      segments.push({
        styled: group.styled,
        node: cloneElementWithChildren(node, group.nodes),
      });
    }
  }

  return segments;
}

function removeStyleSegments(nodes, tag, start, end, underTarget = false) {
  const segments = [];

  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node) {
      continue;
    }

    if (node.type === "text") {
      if (end <= node.visibleStart || start >= node.visibleEnd) {
        segments.push({ styled: underTarget, node: cloneNode(node) });
        continue;
      }

      const split = splitTextByVisibleRange(node, start, end);
      if (split.before) {
        segments.push({ styled: underTarget, node: textNode(split.before, 0, 0, 0) });
      }
      if (split.middle) {
        segments.push({ styled: false, node: textNode(split.middle, 0, 0, 0) });
      }
      if (split.after) {
        segments.push({ styled: underTarget, node: textNode(split.after, 0, 0, 0) });
      }
      continue;
    }

    if (node.tag === "ruby" && tag !== "ruby") {
      if (end <= node.visibleStart || start >= node.visibleEnd) {
        segments.push({ styled: underTarget, node: cloneNode(node) });
        continue;
      }

      segments.push({ styled: false, node: cloneNode(node) });
      continue;
    }

    if (node.tag === tag) {
      if (end <= node.visibleStart || start >= node.visibleEnd) {
        segments.push({ styled: underTarget, node: cloneNode(node) });
        continue;
      }

      segments.push(...removeStyleSegments(node.children, tag, start, end, true));
      continue;
    }

    if (end <= node.visibleStart || start >= node.visibleEnd) {
      segments.push({ styled: underTarget, node: cloneNode(node) });
      continue;
    }

    const childSegments = removeStyleSegments(node.children, tag, start, end, underTarget);
    for (const group of groupSegmentsByStyle(childSegments)) {
      segments.push({
        styled: group.styled,
        node: cloneElementWithChildren(node, group.nodes),
      });
    }
  }

  return segments;
}

function groupSegmentsByStyle(segments) {
  const groups = [];
  let current = null;

  for (const segment of Array.isArray(segments) ? segments : []) {
    if (!segment?.node) {
      continue;
    }

    if (!current || current.styled !== segment.styled) {
      current = {
        styled: segment.styled,
        nodes: [],
      };
      groups.push(current);
    }

    current.nodes.push(segment.node);
  }

  return groups;
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

export function extractInlineMarkupVisibleText(value) {
  return parseInlineMarkup(value).visibleText;
}

export function renderSanitizedInlineMarkupHtml(value) {
  const parsed = parseInlineMarkup(value);
  return serializeNodes(parsed.nodes);
}

export function extractInlineMarkupHistoryText(value) {
  return flattenNodesToHistoryText(parseInlineMarkup(value).nodes);
}

export function renderSanitizedInlineMarkupHistoryHtml(value) {
  return renderNodesForHistoryHtml(parseInlineMarkup(value).nodes);
}

function normalizeVisibleHighlightRanges(ranges, visibleLength = 0) {
  return (Array.isArray(ranges) ? ranges : [])
    .map((range) => ({
      ...range,
      start: Math.max(0, Math.min(visibleLength, Number.parseInt(range?.start ?? "", 10) || 0)),
      end: Math.max(0, Math.min(visibleLength, Number.parseInt(range?.end ?? "", 10) || 0)),
    }))
    .filter((range) => range.end > range.start)
    .sort((left, right) => {
      if (left.start !== right.start) {
        return left.start - right.start;
      }

      return left.end - right.end;
    });
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

function unwrapWholeElement(parsed, targetNode) {
  if (targetNode?.tag === "ruby") {
    const { baseChildren } = splitRubyNodeChildren(targetNode.children);
    return (
      parsed.source.slice(0, targetNode.rawStart)
      + serializeNodes(baseChildren)
      + parsed.source.slice(targetNode.closeEnd >= 0 ? targetNode.closeEnd : targetNode.rawEnd)
    );
  }

  const nextValue =
    parsed.source.slice(0, targetNode.rawStart)
    + parsed.source.slice(targetNode.openEnd, targetNode.closeStart >= 0 ? targetNode.closeStart : targetNode.rawEnd)
    + parsed.source.slice(targetNode.closeEnd >= 0 ? targetNode.closeEnd : targetNode.rawEnd);

  return nextValue;
}

function toggleResult(value, selectionStart, selectionEnd, selectionDirection = "none", changed = true) {
  return {
    value,
    selectionStart,
    selectionEnd,
    selectionDirection,
    changed,
  };
}

export function describeInlineMarkupSelection(value, selectionStart, selectionEnd) {
  const parsed = parseInlineMarkup(value);
  const start = Math.max(0, Math.min(parsed.source.length, Number.parseInt(selectionStart ?? "", 10) || 0));
  const end = Math.max(start, Math.min(parsed.source.length, Number.parseInt(selectionEnd ?? "", 10) || 0));
  const collapsed = start === end;
  const activeStyles = {
    bold: false,
    italic: false,
    underline: false,
    ruby: false,
  };

  for (const [tag, style] of Object.entries(TAG_TO_STYLE)) {
    if (collapsed) {
      activeStyles[style] = Boolean(findElementContainingCursor(parsed, tag, start));
      continue;
    }

    activeStyles[style] = Boolean(findElementContainingSelection(parsed, tag, start, end));
  }

  return {
    collapsed,
    activeStyles,
  };
}

function insertPairAtCursor(value, selectionStart, selectionDirection, openTag, closeTag) {
  const source = String(value ?? "");
  const cursor = Math.max(0, Math.min(source.length, Number.parseInt(selectionStart ?? "", 10) || 0));
  const nextValue = source.slice(0, cursor) + openTag + closeTag + source.slice(cursor);
  const nextSelectionStart = cursor + openTag.length;

  return toggleResult(
    nextValue,
    nextSelectionStart,
    nextSelectionStart,
    selectionDirection,
  );
}

function insertRubyAtCursor(value, selectionStart, selectionDirection, placeholder) {
  const source = String(value ?? "");
  const cursor = Math.max(0, Math.min(source.length, Number.parseInt(selectionStart ?? "", 10) || 0));
  const openTag = "<ruby><rt>";
  const closeTag = "</rt></ruby>";
  const nextValue = source.slice(0, cursor) + openTag + placeholder + closeTag + source.slice(cursor);
  const selectionAnchor = cursor + openTag.length;

  return toggleResult(
    nextValue,
    selectionAnchor,
    selectionAnchor + placeholder.length,
    selectionDirection,
  );
}

function wrapRubySelection(value, selectionStart, selectionEnd, selectionDirection, placeholder) {
  const source = String(value ?? "");
  const start = Math.max(0, Math.min(source.length, Number.parseInt(selectionStart ?? "", 10) || 0));
  const end = Math.max(start, Math.min(source.length, Number.parseInt(selectionEnd ?? "", 10) || 0));
  const selected = source.slice(start, end);
  const openTag = "<ruby>";
  const middleTag = "<rt>";
  const closeTag = "</rt></ruby>";
  const nextValue =
    source.slice(0, start)
    + openTag
    + selected
    + middleTag
    + placeholder
    + closeTag
    + source.slice(end);
  const placeholderStart = start + openTag.length + selected.length + middleTag.length;

  return toggleResult(
    nextValue,
    placeholderStart,
    placeholderStart + placeholder.length,
    selectionDirection,
  );
}

function rebuildValueAfterStyleTransform(parsed, nextNodes, selectionVisibleStart, selectionVisibleEnd, selectionDirection = "none") {
  const nextValue = serializeNodes(nextNodes);
  const nextParsed = parseInlineMarkup(nextValue);
  const nextSelectionStart = visiblePositionToRawOffset(nextParsed, selectionVisibleStart, "start");
  const nextSelectionEnd = visiblePositionToRawOffset(nextParsed, selectionVisibleEnd, "end");
  return toggleResult(
    nextValue,
    nextSelectionStart,
    nextSelectionEnd,
    selectionDirection,
  );
}

export function toggleInlineMarkupSelection({
  value,
  selectionStart,
  selectionEnd,
  selectionDirection = "none",
  style,
  languageCode = "",
}) {
  const tag = normalizeInlineStyle(style);
  if (!tag) {
    return toggleResult(String(value ?? ""), selectionStart ?? 0, selectionEnd ?? 0, selectionDirection, false);
  }

  const source = String(value ?? "");
  const start = Math.max(0, Math.min(source.length, Number.parseInt(selectionStart ?? "", 10) || 0));
  const end = Math.max(start, Math.min(source.length, Number.parseInt(selectionEnd ?? "", 10) || 0));
  const parsed = parseInlineMarkup(source);
  const collapsedWordRange = start === end ? collapsedWordVisibleRange(parsed, start) : null;
  const selectionVisibleStart = collapsedWordRange
    ? collapsedWordRange.start
    : rawOffsetToVisiblePosition(parsed, start);
  const selectionVisibleEnd = collapsedWordRange
    ? collapsedWordRange.end
    : rawOffsetToVisiblePosition(parsed, end);
  const effectiveStart = collapsedWordRange
    ? visiblePositionToRawOffset(parsed, selectionVisibleStart, "start")
    : start;
  const effectiveEnd = collapsedWordRange
    ? visiblePositionToRawOffset(parsed, selectionVisibleEnd, "end")
    : end;
  const isCollapsed = effectiveStart === effectiveEnd;

  if (tag === "ruby") {
    const rubyConfig = rubyButtonConfig(languageCode);
    if (isCollapsed) {
      const activeRuby = findElementContainingCursor(parsed, "ruby", effectiveStart);
      if (activeRuby) {
        const nextValue = unwrapWholeElement(parsed, activeRuby);
        const nextParsed = parseInlineMarkup(nextValue);
        const nextVisiblePosition = rawOffsetToVisiblePosition(parsed, effectiveStart);
        const nextCursor = visiblePositionToRawOffset(nextParsed, nextVisiblePosition, "start");
        return toggleResult(nextValue, nextCursor, nextCursor, selectionDirection);
      }

      return insertRubyAtCursor(source, effectiveStart, selectionDirection, rubyConfig.placeholder);
    }

    const selectedRuby = findElementContainingSelection(parsed, "ruby", effectiveStart, effectiveEnd);
    if (selectedRuby) {
      const nextValue = unwrapWholeElement(parsed, selectedRuby);
      const nextParsed = parseInlineMarkup(nextValue);
      return toggleResult(
        nextValue,
        visiblePositionToRawOffset(nextParsed, selectionVisibleStart, "start"),
        visiblePositionToRawOffset(nextParsed, selectionVisibleEnd, "end"),
        selectionDirection,
      );
    }

    return wrapRubySelection(
      source,
      effectiveStart,
      effectiveEnd,
      selectionDirection,
      rubyConfig.placeholder,
    );
  }

  if (isCollapsed) {
    const activeElement = findElementContainingCursor(parsed, tag, effectiveStart);
    if (activeElement) {
      const nextValue = unwrapWholeElement(parsed, activeElement);
      const nextParsed = parseInlineMarkup(nextValue);
      const nextVisiblePosition = rawOffsetToVisiblePosition(parsed, effectiveStart);
      const nextCursor = visiblePositionToRawOffset(nextParsed, nextVisiblePosition, "start");
      return toggleResult(nextValue, nextCursor, nextCursor, selectionDirection);
    }

    return insertPairAtCursor(source, effectiveStart, selectionDirection, `<${tag}>`, `</${tag}>`);
  }

  const selectedElement = findElementContainingSelection(parsed, tag, effectiveStart, effectiveEnd);

  if (selectedElement) {
    const nextNodes = materializeStyledSegments(
      removeStyleSegments(parsed.nodes, tag, selectionVisibleStart, selectionVisibleEnd),
      tag,
    );
    return rebuildValueAfterStyleTransform(
      parsed,
      nextNodes,
      selectionVisibleStart,
      selectionVisibleEnd,
      selectionDirection,
    );
  }

  const nextNodes = materializeStyledSegments(
    applyStyleSegments(parsed.nodes, tag, selectionVisibleStart, selectionVisibleEnd),
    tag,
  );
  return rebuildValueAfterStyleTransform(
    parsed,
    nextNodes,
    selectionVisibleStart,
    selectionVisibleEnd,
    selectionDirection,
  );
}
